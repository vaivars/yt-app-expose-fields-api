import { beforeEach, describe, expect, it } from 'vitest';
import { httpHandler } from '../../src/backend/api';
import {
  COMPACT_ISSUE_PROJECTION,
  COMPACT_PROJECTION,
  FULL_PROJECTION,
  ISSUE_PROJECTION,
} from '../../src/core/projection';
import { httpFake } from '../fakes/scripting-api/http';
import { fakeIssue, fakeRequest, fakeResponse, fakeUser, fakeYouTrack } from '../fakes/youtrack';

const PRIORITY = { name: 'Priority', value: { name: 'Major' }, $type: 'SingleEnumIssueCustomField' };
const EXTERNAL_ID = { name: 'External ID', value: 'X-9', $type: 'SimpleIssueCustomField' };
const BASE = { idReadable: 'ABC-1', summary: 'S', $type: 'Issue' };
const COMPACT = `${COMPACT_ISSUE_PROJECTION},customFields(${COMPACT_PROJECTION})`;
const FULL = `${ISSUE_PROJECTION},customFields(${FULL_PROJECTION})`;
const SETTINGS = { exposedFields: 'External ID', serviceToken: 'perm:t' };

function call(
  method: string,
  options: {
    params?: Record<string, string>;
    body?: string;
    contentType?: string | null;
    visible?: boolean;
    user?: ReturnType<typeof fakeUser>;
  } = {},
) {
  const endpoint = httpHandler.endpoints.find((candidate) => candidate.method === method && candidate.path === 'issue');
  if (!endpoint) throw new Error(`no ${method} issue endpoint`);
  const response = fakeResponse();
  endpoint.handle({
    issue: fakeIssue({ readable: ['Priority'], visible: options.visible ?? true }) as never,
    currentUser: (options.user ?? fakeUser()) as never,
    settings: SETTINGS,
    request: fakeRequest(
      options.params,
      options.body,
      options.contentType === null ? {} : { 'Content-Type': options.contentType ?? 'application/json' },
    ),
    response,
  });
  return response;
}

beforeEach(() => {
  httpFake.reset();
  httpFake.respond = fakeYouTrack([PRIORITY, EXTERNAL_ID], BASE);
});

describe('httpHandler', () => {
  it('declares GET and POST on the issue-scoped path issue', () => {
    expect(httpHandler.endpoints.map((endpoint) => [endpoint.method, endpoint.scope, endpoint.path])).toEqual([
      ['GET', 'issue', 'issue'],
      ['POST', 'issue', 'issue'],
    ]);
  });

  it('GET returns the ticket with readable and exposed fields, compact, calling YouTrack as the technical user', () => {
    const response = call('GET');
    expect(response.code).toBe(200);
    expect(response.body).toEqual({
      idReadable: 'ABC-1',
      summary: 'S',
      customFields: [PRIORITY, EXTERNAL_ID],
      $type: 'Issue',
    });
    expect(httpFake.calls.map((c) => [c.url, c.timeout, c.token, c.method, c.uri, c.queryParams?.fields])).toEqual([
      ['https://yt.example', 10000, 'perm:t', 'GET', '/api/issues/ABC-1', COMPACT],
    ]);
  });

  it("GET with full=true asks YouTrack for its full output; other values don't", () => {
    for (const [full, projections] of [
      ['true', [FULL]],
      [' TRUE ', [FULL]],
      ['false', [COMPACT]],
      ['1', [COMPACT]],
      ['', [COMPACT]],
    ] as const) {
      httpFake.calls = [];
      expect(call('GET', { params: { full } }).code).toBe(200);
      expect(
        httpFake.calls.map((c) => c.queryParams?.fields),
        full,
      ).toEqual(projections);
    }
  });

  it('GET with fields returns only the named fields, and lists the ones it did not return as given', () => {
    expect(call('GET', { params: { fields: 'external id' } }).body).toEqual({
      idReadable: 'ABC-1',
      customFields: [EXTERNAL_ID],
      $type: 'Issue',
    });
    expect(call('GET', { params: { fields: 'external id, Typo' } }).body).toEqual({
      idReadable: 'ABC-1',
      customFields: [EXTERNAL_ID],
      missing: ['Typo'],
      $type: 'Issue',
    });
  });

  it('POST updates an exposed field and returns a short status', () => {
    const response = call('POST', { body: '{"field":"External ID","value":"NEW-1"}' });
    expect(response.code).toBe(200);
    expect(response.body).toEqual({ idReadable: 'ABC-1', field: 'External ID', status: 'updated' });
    const post = httpFake.calls.find((c) => c.method === 'POST');
    expect(post?.headers).toEqual([['Content-Type', 'application/json']]);
    expect(JSON.parse(post?.payload ?? '')).toEqual({
      customFields: [{ name: 'External ID', $type: 'SimpleIssueCustomField', value: 'NEW-1' }],
    });
  });

  it("POST with full=true returns the fresh entry in YouTrack's full output", () => {
    const response = call('POST', { params: { full: 'true' }, body: '{"field":"External ID","value":"NEW-1"}' });
    expect(response.body).toEqual({
      idReadable: 'ABC-1',
      customFields: [{ ...EXTERNAL_ID, value: 'NEW-1' }],
      $type: 'Issue',
    });
    expect(httpFake.calls.map((c) => `${c.method} ${c.queryParams?.fields}`)).toEqual([
      'GET $type,name',
      `POST idReadable,customFields(${FULL_PROJECTION})`,
    ]);
  });

  it('POST clears a field with null and rejects a body without value or that is not a JSON object', () => {
    expect(call('POST', { body: '{"field":"External ID","value":null}' }).code).toBe(200);
    expect(call('POST', { body: '{"field":"External ID"}' }).body).toEqual({
      error: 'bad_request',
      error_description: 'value is required; use null to clear the field',
    });
    for (const body of ['', 'not json', '[1]', '"x"']) {
      const response = call('POST', { body });
      expect(response.code, body).toBe(400);
      expect(response.body).toEqual({
        error: 'bad_request',
        error_description: 'The request body must be a JSON object like {"field": "<name>", "value": <value>}',
      });
    }
  });

  it('POST accepts application/json with parameters and refuses any other content type without calling YouTrack', () => {
    const body = '{"field":"External ID","value":"NEW-1"}';
    expect(call('POST', { body, contentType: 'application/json; charset=utf-8' }).code).toBe(200);
    httpFake.calls = [];
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', null]) {
      const response = call('POST', { body, contentType });
      expect(response.code, String(contentType)).toBe(415);
      expect(response.body).toEqual({
        error: 'unsupported_media_type',
        error_description: 'Send the request body as application/json',
      });
    }
    expect(httpFake.calls).toEqual([]);
  });

  it('POST refuses callers without the update permission', () => {
    const response = call('POST', {
      body: '{"field":"External ID","value":"x"}',
      user: fakeUser('jane', [], ['READ_ISSUE']),
    });
    expect(response.code).toBe(403);
    expect(httpFake.calls).toEqual([]);
  });

  it('answers 404 without calling YouTrack when the caller cannot see the issue', () => {
    for (const method of ['GET', 'POST']) {
      const response = call(method, { visible: false, body: '{"field":"External ID","value":"x"}' });
      expect(response.code).toBe(404);
      expect(response.body).toEqual({ error: 'not_found', error_description: 'Issue "ABC-1" was not found' });
    }
    expect(httpFake.calls).toEqual([]);
  });
});
