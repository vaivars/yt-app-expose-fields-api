import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  COMPACT_ISSUE_PROJECTION,
  COMPACT_PROJECTION,
  FULL_PROJECTION,
  ISSUE_PROJECTION,
} from '../../src/core/projection';
import { appLogs, appSettings, callTool, callToolRaw, type Entry, get, post, restoreStringField } from './client.ts';
import { contractEnv as env } from './env.ts';

const ISSUE = `/api/issues/${env.issue}`;
const APP = `${ISSUE}/extensionEndpoints/hidden-fields/api/issue`;
const EXPOSED = new Set(env.exposed);
const WRITABLE = 'HF External ID';
const WRITABLE_FIXTURE = 'EXT-42';
const SECRET = /do not expose|HF Internal Note/;

type IssueBody = Record<string, unknown> & { customFields: Entry[] };

/** Same JSON, same key order. */
function same(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

/** Entries keyed by name, for comparisons where YouTrack's field order may differ between users. */
function byName(entries: Entry[]): [string, string][] {
  return entries.map((entry): [string, string] => [String(entry.name), JSON.stringify(entry)]).sort();
}

/** The technical user's entries in the given projection (compact by default), kept by name. */
async function techEntries(keep: (name: string) => boolean, projection = COMPACT_PROJECTION): Promise<Entry[]> {
  const { body } = await get<Entry[]>(env.techToken, `${ISSUE}/customFields?$top=-1`, projection);
  return body.filter((entry) => keep(String(entry.name)));
}

async function userFieldNames(): Promise<Set<string>> {
  const { body } = await get<Entry[]>(env.userToken, `${ISSUE}/customFields?$top=-1`, 'name');
  return new Set(body.map((entry) => String(entry.name)));
}

async function techValue(name: string): Promise<unknown> {
  return (await techEntries((entry) => entry === name))[0]?.value;
}

/** Puts the writable field back to its fixture value after any test that may have changed it. */
afterEach(async () => {
  if ((await techValue(WRITABLE)) !== WRITABLE_FIXTURE) await restoreStringField(WRITABLE, WRITABLE_FIXTURE);
});

describe('premise', () => {
  it("hides the restricted fields from the regular user's own REST call", async () => {
    const names = await userFieldNames();
    for (const hidden of [...env.exposed, env.unexposed]) expect(names.has(hidden)).toBe(false);
  });
});

describe('get_issue over REST', () => {
  it("returns the user's own issue attributes plus their fields and the exposed ones, compact", async () => {
    const readable = await userFieldNames();
    const actual = await get<IssueBody>(env.userToken, APP);
    expect(actual.status).toBe(200);
    const { customFields, ...attributes } = actual.body;
    const own = await get<Record<string, unknown>>(env.userToken, ISSUE, COMPACT_ISSUE_PROJECTION);
    same(attributes, own.body);
    same(customFields, await techEntries((name) => readable.has(name) || EXPOSED.has(name)));
  });

  it("returns YouTrack's full output with full=true", async () => {
    const readable = await userFieldNames();
    const actual = await get<IssueBody>(env.userToken, `${APP}?full=true`);
    expect(actual.status).toBe(200);
    const { customFields, ...attributes } = actual.body;
    const own = await get<Record<string, unknown>>(env.userToken, ISSUE, ISSUE_PROJECTION);
    same(attributes, own.body);
    same(customFields, await techEntries((name) => readable.has(name) || EXPOSED.has(name), FULL_PROJECTION));
  });

  it('returns only the named fields, and lists an unexposed hidden one like a field that does not exist', async () => {
    const names = encodeURIComponent(`HF External ID,priority,${env.unexposed},No Such Field`);
    const { status, body } = await get<IssueBody>(env.userToken, `${APP}?fields=${names}`);
    expect(status).toBe(200);
    same(body, {
      idReadable: env.issue,
      customFields: await techEntries((name) => name === 'Priority' || name === 'HF External ID'),
      missing: [env.unexposed, 'No Such Field'],
      $type: 'Issue',
    });
  });

  it('never returns the unexposed hidden field, even for projection-like input', async () => {
    for (const query of [
      '',
      '?full=true',
      '?fields=projectCustomField(project(issues(idReadable,customFields(name,value(name)))))',
    ]) {
      const { status, body } = await get<IssueBody>(env.userToken, `${APP}${query}`);
      expect(status, query).toBe(200);
      expect(JSON.stringify(body)).not.toMatch(SECRET);
    }
  });
});

describe('update_issue over REST', () => {
  it('sets an exposed field as the technical user and returns a short status', async () => {
    const { status, body } = await post<IssueBody>(env.userToken, APP, { field: WRITABLE, value: 'CONTRACT-1' });
    expect(status).toBe(200);
    same(body, { idReadable: env.issue, field: WRITABLE, status: 'updated' });
    expect(await techValue(WRITABLE)).toBe('CONTRACT-1');
    const history = await get<{ author: { login: string }; field: { presentation: string }; added: unknown }[]>(
      env.techToken,
      `${ISSUE}/activities?categories=CustomFieldCategory&$top=-1`,
      'author(login),field(presentation),added',
    );
    const last = history.body.filter((activity) => activity.field.presentation === WRITABLE).at(-1);
    expect(last).toMatchObject({ author: { login: 'hf-tech' }, added: 'CONTRACT-1' });
  });

  it("returns the fresh entry in YouTrack's full output with full=true", async () => {
    const { status, body } = await post<IssueBody>(env.userToken, `${APP}?full=true`, {
      field: WRITABLE,
      value: 'CONTRACT-FULL',
    });
    expect(status).toBe(200);
    same(body, {
      idReadable: env.issue,
      customFields: await techEntries((name) => name === WRITABLE, FULL_PROJECTION),
      $type: 'Issue',
    });
    expect(await techValue(WRITABLE)).toBe('CONTRACT-FULL');
  });

  it('logs the real caller of a write, without the value', async () => {
    await post(env.userToken, APP, { field: WRITABLE, value: 'LOGGED-VALUE' });
    const logs = appLogs();
    expect(logs).toContain(`update_issue: hf-user set "${WRITABLE}" on ${env.issue}`);
    expect(logs).not.toContain('LOGGED-VALUE');
  });

  it('refuses writes that are not sent as JSON, so other web pages cannot submit them', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const { status } = await post(env.userToken, APP, { field: WRITABLE, value: 'NOT-JSON', pad: '=' }, contentType);
      expect(status, contentType).toBe(415);
    }
    expect(await techValue(WRITABLE)).toBe(WRITABLE_FIXTURE);
  });

  it('clears a field with null', async () => {
    const { status } = await post(env.userToken, APP, { field: WRITABLE, value: null });
    expect(status).toBe(200);
    expect(await techValue(WRITABLE)).toBeNull();
  });

  it('refuses fields that are not exposed', async () => {
    for (const field of [env.unexposed, 'Priority']) {
      const { status, body } = await post<{ error: string }>(env.userToken, APP, { field, value: { name: 'x' } });
      expect(status, field).toBe(403);
      expect(body.error).toBe('forbidden');
    }
    expect(await techValue(env.unexposed)).toBe('do not expose');
  });

  it("passes YouTrack's 400 for a value of the wrong type through", async () => {
    const { status, body } = await post<{ error: string; error_description: string }>(env.userToken, APP, {
      field: WRITABLE,
      value: { name: 'not a string' },
    });
    expect(status).toBe(400);
    expect(body.error_description).toContain('Incompatible value format');
  });
});

describe('users who cannot see the issue', () => {
  it('get 404 from GET and POST', async () => {
    const read = await get<unknown>(env.outsiderToken, APP);
    const write = await post<unknown>(env.outsiderToken, APP, { field: WRITABLE, value: 'OUTSIDER' });
    for (const response of [read, write]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toMatch(SECRET);
    }
    expect(await techValue(WRITABLE)).toBe(WRITABLE_FIXTURE);
  });

  it('get a not-found error from both MCP tools', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['hidden_fields_get_issue', { issueId: env.issue }],
      ['hidden_fields_update_issue', { issueId: env.issue, field: WRITABLE, value: 'OUTSIDER' }],
    ];
    for (const [tool, args] of calls) {
      const { isError, text } = await callToolRaw(env.outsiderToken, tool, args);
      expect(isError, tool).toBe(true);
      expect(text).toContain('was not found');
      expect(text).not.toMatch(SECRET);
    }
  });
});

describe('users who can see the issue but not update it', () => {
  it('can read the exposed fields', async () => {
    const { status, body } = await get<IssueBody>(env.readerToken, `${APP}?fields=${encodeURIComponent(WRITABLE)}`);
    expect(status).toBe(200);
    expect(body.customFields.map((entry) => entry.name)).toEqual([WRITABLE]);
  });

  it('are refused over REST and MCP', async () => {
    const rest = await post<{ error: string; error_description: string }>(env.readerToken, APP, {
      field: WRITABLE,
      value: 'READER',
    });
    expect(rest.status).toBe(403);
    expect(rest.body.error_description).toBe('You are not allowed to update this issue');
    const tool = await callToolRaw(env.readerToken, 'hidden_fields_update_issue', {
      issueId: env.issue,
      field: WRITABLE,
      value: 'READER',
    });
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain('You are not allowed to update this issue');
    expect(await techValue(WRITABLE)).toBe(WRITABLE_FIXTURE);
  });
});

describe('allowed group', () => {
  beforeAll(async () => {
    await appSettings(env.group);
  });
  afterAll(async () => {
    await appSettings(null);
  });

  it('gives non-members only their own fields, over REST and MCP', async () => {
    const own = await get<Entry[]>(env.userToken, `${ISSUE}/customFields?$top=-1`, COMPACT_PROJECTION);
    const rest = await get<IssueBody>(env.userToken, APP);
    const tool = (await callTool(env.userToken, 'hidden_fields_get_issue', { issueId: env.issue })) as IssueBody;
    expect(byName(rest.body.customFields)).toEqual(byName(own.body));
    expect(byName(tool.customFields)).toEqual(byName(own.body));
  });

  it('refuses updates from non-members, over REST and MCP', async () => {
    const rest = await post<{ error: string }>(env.userToken, APP, { field: WRITABLE, value: 'NON-MEMBER' });
    expect(rest.status).toBe(403);
    const tool = await callToolRaw(env.userToken, 'hidden_fields_update_issue', {
      issueId: env.issue,
      field: WRITABLE,
      value: 'NON-MEMBER',
    });
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain('forbidden');
    expect(await techValue(WRITABLE)).toBe(WRITABLE_FIXTURE);
  });
});

describe('MCP', () => {
  it('get_issue matches the REST endpoint, with and without fields and full', async () => {
    const names = encodeURIComponent(`State,${WRITABLE},No Such Field`);
    const list = ['State', WRITABLE, 'No Such Field'];
    const cases: [Record<string, unknown>, string][] = [
      [{}, ''],
      [{ fields: list }, `?fields=${names}`],
      [{ full: true }, '?full=true'],
      [{ fields: list, full: true }, `?fields=${names}&full=true`],
    ];
    for (const [args, query] of cases) {
      same(
        await callTool(env.userToken, 'hidden_fields_get_issue', { issueId: env.issue, ...args }),
        (await get(env.userToken, `${APP}${query}`)).body,
      );
    }
  });

  it('update_issue sets an exposed field and clears it only with clear: true', async () => {
    const set = await callTool(env.userToken, 'hidden_fields_update_issue', {
      issueId: env.issue,
      field: WRITABLE,
      value: 'MCP-1',
    });
    same(set, { idReadable: env.issue, field: WRITABLE, status: 'updated' });
    expect(await techValue(WRITABLE)).toBe('MCP-1');
    const full = (await callTool(env.userToken, 'hidden_fields_update_issue', {
      issueId: env.issue,
      field: WRITABLE,
      value: 'MCP-1',
      full: true,
    })) as IssueBody;
    same(full.customFields, await techEntries((name) => name === WRITABLE, FULL_PROJECTION));
    const missing = await callToolRaw(env.userToken, 'hidden_fields_update_issue', {
      issueId: env.issue,
      field: WRITABLE,
    });
    expect(missing.isError).toBe(true);
    expect(await techValue(WRITABLE)).toBe('MCP-1');
    await callTool(env.userToken, 'hidden_fields_update_issue', { issueId: env.issue, field: WRITABLE, clear: true });
    expect(await techValue(WRITABLE)).toBeNull();
  });
});
