import { describe, expect, it } from 'vitest';
import { getIssue, updateIssue } from '../../src/core/issue';
import { FULL_PROJECTION, ISSUE_PROJECTION } from '../../src/core/projection';
import type { HttpConnectionLike, HttpResponseLike, ReadInput, UpdateInput } from '../../src/core/types';

const PRIORITY = { $type: 'SingleEnumIssueCustomField', id: '1', name: 'Priority', value: { name: 'Major' } };
const EXTERNAL_ID = { $type: 'SimpleIssueCustomField', id: '2', name: 'External ID', value: 'X-9' };
const NOTE = { $type: 'SimpleIssueCustomField', id: '3', name: 'Internal Note', value: 'n' };
const STATE = { $type: 'StateIssueCustomField', id: '4', name: 'State', value: { name: 'Open' } };
const FIELDS = [PRIORITY, EXTERNAL_ID, NOTE, STATE];
const BASE = { idReadable: 'ABC-1', summary: 'S', description: null, $type: 'Issue', project: { shortName: 'ABC' } };

interface Call {
  method: string;
  uri: string;
  query: Record<string, string>;
  payload?: unknown;
}

/** A fake YouTrack: answers customFields and issue GETs, records every call and accepts POSTs. */
function youTrack(overrides: { fields?: unknown; base?: HttpResponseLike; post?: HttpResponseLike } = {}) {
  const calls: Call[] = [];
  let fields = overrides.fields ?? FIELDS;
  const connection: HttpConnectionLike = {
    bearerAuth: () => undefined,
    addHeader: () => undefined,
    getSync(uri, query) {
      calls.push({ method: 'GET', uri, query });
      if (uri.endsWith('/customFields')) return { code: 200, response: JSON.stringify(fields) };
      return overrides.base ?? { code: 200, response: JSON.stringify(BASE) };
    },
    postSync(uri, query, payload) {
      const parsed = JSON.parse(payload) as { customFields: { name: string; value: unknown }[] };
      calls.push({ method: 'POST', uri, query, payload: parsed });
      const response = overrides.post ?? { code: 200, response: '{"idReadable":"ABC-1"}' };
      if (response.code === 200) {
        const update = parsed.customFields[0];
        fields = (fields as { name: string }[]).map((entry) =>
          entry.name === update?.name ? { ...entry, value: update.value } : entry,
        );
      }
      return response;
    },
  };
  return { connection, calls };
}

function readInput(overrides: Partial<ReadInput> = {}, fake = youTrack()) {
  const warnings: string[] = [];
  const connected: string[] = [];
  const input: ReadInput = {
    issueId: 'ABC-1',
    issueUrl: 'https://yt.example/issue/ABC-1',
    settings: { exposedFields: 'External ID', serviceToken: 'perm:secret-token' },
    user: { isInGroup: () => false },
    connect: (baseUrl) => {
      connected.push(baseUrl);
      return fake.connection;
    },
    canRead: (name) => name === 'Priority' || name === 'State',
    projectFieldNames: () => FIELDS.map((entry) => entry.name),
    log: { warn: (message) => warnings.push(message), info: () => undefined },
    ...overrides,
  };
  return { input, warnings, connected, calls: fake.calls };
}

function updateInput(overrides: Partial<UpdateInput> = {}, fake = youTrack()) {
  const logged: string[] = [];
  const input: UpdateInput = {
    issueId: 'ABC-1',
    issueUrl: 'https://yt.example/issue/ABC-1',
    settings: { exposedFields: 'External ID', serviceToken: 'perm:secret-token' },
    user: { isInGroup: () => false },
    connect: () => fake.connection,
    field: 'External ID',
    value: 'NEW-1',
    actor: 'jane',
    canUpdate: () => true,
    log: { warn: (message) => logged.push(`warn: ${message}`), info: (message) => logged.push(`info: ${message}`) },
    ...overrides,
  };
  return { input, calls: fake.calls, logged };
}

describe('getIssue', () => {
  it('returns the ticket with the readable and exposed fields, $type last', () => {
    const { input, calls } = readInput();
    const result = getIssue(input);
    expect(result).toEqual({
      status: 200,
      body: { ...BASE, customFields: [PRIORITY, EXTERNAL_ID, STATE] },
    });
    expect(Object.keys(result.body).at(-1)).toBe('$type');
    expect(calls).toEqual([
      { method: 'GET', uri: '/api/issues/ABC-1/customFields', query: { fields: FULL_PROJECTION, $top: '-1' } },
      { method: 'GET', uri: '/api/issues/ABC-1', query: { fields: ISSUE_PROJECTION } },
    ]);
  });

  it('returns only the named fields without the ticket attributes', () => {
    const { input, calls } = readInput({ names: [' priority ', 'EXTERNAL ID'] });
    expect(getIssue(input)).toEqual({
      status: 200,
      body: { idReadable: 'ABC-1', customFields: [PRIORITY, EXTERNAL_ID], $type: 'Issue' },
    });
    expect(calls).toHaveLength(1);
  });

  it('never returns a named field that is neither readable nor exposed', () => {
    const { input } = readInput({ names: ['Internal Note', 'State'] });
    expect(getIssue(input).body).toEqual({ idReadable: 'ABC-1', customFields: [STATE], $type: 'Issue' });
  });

  it('treats blank names as no filter', () => {
    const { input } = readInput({ names: ['', '  '] });
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY, EXTERNAL_ID, STATE]);
  });

  it('matches exposed names from the setting trimmed and case-insensitively', () => {
    const { input } = readInput({ settings: { exposedFields: '  external id ', serviceToken: 't' } });
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY, EXTERNAL_ID, STATE]);
  });

  it('gives non-members of the allowed group only the fields they can read', () => {
    const { input } = readInput({
      settings: { exposedFields: 'External ID', serviceToken: 't', allowedGroup: 'Integrations' },
    });
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY, STATE]);
  });

  it('gives members of the allowed group the exposed fields', () => {
    const { input } = readInput({
      user: { isInGroup: (name) => name === 'Integrations' },
      settings: { exposedFields: 'External ID', serviceToken: 't', allowedGroup: 'Integrations' },
    });
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY, EXTERNAL_ID, STATE]);
  });

  it('treats a field whose readability check throws as unreadable', () => {
    const { input } = readInput({
      canRead: (name) => {
        if (name === 'State') throw new Error('no such field');
        return name === 'Priority';
      },
    });
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY, EXTERNAL_ID]);
  });

  it('passes upstream errors from either call through', () => {
    const failingFields = readInput({}, youTrack({ fields: { not: 'an array' } }));
    expect(getIssue(failingFields.input)).toEqual({
      status: 502,
      body: { error: 'upstream_error', error_description: 'technical user request returned an unexpected body' },
    });
    const failingBase = readInput({}, youTrack({ base: { code: 500, response: 'boom' } }));
    expect(getIssue(failingBase.input)).toEqual({
      status: 502,
      body: { error: 'upstream_error', error_description: 'technical user request failed (HTTP 500)' },
    });
  });

  it('calls the youtrackUrl override, or the base URL derived from the issue', () => {
    const derived = readInput();
    getIssue(derived.input);
    expect(derived.connected[0]).toBe('https://yt.example');
    const overridden = readInput({
      settings: { exposedFields: 'X', serviceToken: 't', youtrackUrl: 'http://localhost:8080/' },
    });
    getIssue(overridden.input);
    expect(overridden.connected[0]).toBe('http://localhost:8080');
  });

  it('reports a configuration error when no base URL can be found', () => {
    const { input } = readInput({ issueUrl: 'about:blank' });
    expect(getIssue(input)).toEqual({
      status: 500,
      body: {
        error: 'configuration_error',
        error_description: 'Cannot derive the YouTrack base URL from "about:blank"; set the youtrackUrl setting',
      },
    });
  });

  it('warns about wanted fields the technical user cannot read, never mentioning the token', () => {
    const { input, warnings } = readInput({}, youTrack({ fields: [PRIORITY, NOTE] }));
    expect((getIssue(input).body as { customFields: unknown[] }).customFields).toEqual([PRIORITY]);
    expect(warnings).toEqual([
      'Field "External ID" exists in the project but the technical user cannot read it',
      'Field "State" exists in the project but the technical user cannot read it',
    ]);
    expect(warnings.join()).not.toContain('secret-token');
  });
});

describe('updateIssue', () => {
  it('writes an exposed field as the technical user and returns its fresh entry', () => {
    const { input, calls } = updateInput();
    expect(updateIssue(input)).toEqual({
      status: 200,
      body: { idReadable: 'ABC-1', customFields: [{ ...EXTERNAL_ID, value: 'NEW-1' }], $type: 'Issue' },
    });
    expect(calls.map((call) => `${call.method} ${call.uri}`)).toEqual([
      'GET /api/issues/ABC-1/customFields',
      'POST /api/issues/ABC-1',
      'GET /api/issues/ABC-1/customFields',
    ]);
    expect(calls[1]?.payload).toEqual({
      customFields: [{ name: 'External ID', $type: 'SimpleIssueCustomField', value: 'NEW-1' }],
    });
  });

  it('logs who wrote which field on which issue, without the value', () => {
    const { input, logged } = updateInput({ value: 'secret session state' });
    updateIssue(input);
    expect(logged).toEqual(['info: update_issue: jane set "External ID" on ABC-1']);
  });

  it('logs nothing when the write is refused or fails', () => {
    const refused = updateInput({ field: 'Priority' });
    updateIssue(refused.input);
    const failed = updateInput({}, youTrack({ post: { code: 500, response: '' } }));
    updateIssue(failed.input);
    expect([...refused.logged, ...failed.logged]).toEqual([]);
  });

  it('matches the field name case-insensitively and sends YouTrack its real name', () => {
    const { input, calls } = updateInput({ field: ' external id ' });
    expect(updateIssue(input).status).toBe(200);
    expect(calls[1]?.payload).toEqual({
      customFields: [{ name: 'External ID', $type: 'SimpleIssueCustomField', value: 'NEW-1' }],
    });
  });

  it('sends null to clear a field', () => {
    const { input, calls } = updateInput({ value: null });
    expect(updateIssue(input).status).toBe(200);
    expect(calls[1]?.payload).toEqual({
      customFields: [{ name: 'External ID', $type: 'SimpleIssueCustomField', value: null }],
    });
  });

  it('requires a field name and a value', () => {
    for (const field of [undefined, '', '  ', 42]) {
      expect(updateIssue(updateInput({ field }).input)).toEqual({
        status: 400,
        body: { error: 'bad_request', error_description: 'field is required' },
      });
    }
    expect(updateIssue(updateInput({ value: undefined }).input)).toEqual({
      status: 400,
      body: { error: 'bad_request', error_description: 'value is required; use null to clear the field' },
    });
  });

  it('refuses non-members of the allowed group, callers who cannot update the issue, and non-exposed fields', () => {
    const cases: [Partial<UpdateInput>, string][] = [
      [
        { settings: { exposedFields: 'External ID', serviceToken: 't', allowedGroup: 'Integrations' } },
        'You are not allowed to update the exposed fields of this issue',
      ],
      [{ canUpdate: () => false }, 'You are not allowed to update this issue'],
      [
        {
          canUpdate: () => {
            throw new Error('no permission API');
          },
        },
        'You are not allowed to update this issue',
      ],
      [{ field: 'Internal Note' }, '"Internal Note" is not an exposed field'],
      [{ field: 'Priority' }, '"Priority" is not an exposed field'],
    ];
    for (const [overrides, description] of cases) {
      const { input, calls } = updateInput(overrides);
      expect(updateIssue(input)).toEqual({ status: 403, body: { error: 'forbidden', error_description: description } });
      expect(calls).toEqual([]);
    }
  });

  it('answers 404 when the technical user cannot find the field on the issue', () => {
    const { input, calls } = updateInput({}, youTrack({ fields: [PRIORITY] }));
    expect(updateIssue(input)).toEqual({
      status: 404,
      body: { error: 'not_found', error_description: 'Field "External ID" was not found on this issue' },
    });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it("passes YouTrack's 400 for an invalid value through", () => {
    const post = {
      code: 400,
      response: '{"error":"","error_description":"Incompatible value format for type string"}',
    };
    const { input } = updateInput({ value: { name: 'x' } }, youTrack({ post }));
    expect(updateIssue(input)).toEqual({
      status: 400,
      body: { error: 'bad_request', error_description: 'Incompatible value format for type string' },
    });
  });

  it('maps other write failures to 502 without the token', () => {
    const { input } = updateInput({}, youTrack({ post: { code: 403, response: 'perm:secret-token denied' } }));
    const result = updateIssue(input);
    expect(result).toEqual({
      status: 502,
      body: { error: 'upstream_error', error_description: 'technical user request failed (HTTP 403)' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
