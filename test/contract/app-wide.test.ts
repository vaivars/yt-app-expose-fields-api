import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Switch } from '../../src/core/switches.ts';
import { appSettings, callToolRaw, cli, type Entry, get, post, restoreStringField } from './client.ts';
import { contractEnv as env } from './env.ts';

const APP = `/api/issues/${env.issue}/extensionEndpoints/hidden-fields/api/issue`;
const GLOBAL_BASE = '/api/extensionEndpoints/hidden-fields/global/issue';
const GLOBAL = `${GLOBAL_BASE}?issueId=${env.issue}`;
const WRITABLE = 'HF External ID';
const WRITABLE_FIXTURE = 'EXT-42';
const PRIVATE_FIELD = 'HF Private Probe';
const MCP_OFF = 'disabled: The MCP tools are turned off in the app settings';

type IssueBody = Record<string, unknown> & { customFields: Entry[]; missing?: string[] };

/** Same JSON, same key order. */
function same(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function notFound(issueId: string) {
  return { error: 'not_found', error_description: `Issue "${issueId}" was not found` };
}

async function remove(path: string): Promise<void> {
  const response = await fetch(`${env.url}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.adminToken}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`could not delete ${path}: HTTP ${response.status}`);
}

async function fieldNames(token: string): Promise<string[]> {
  const { body } = await get<Entry[]>(token, `/api/issues/${env.issue}/customFields?$top=-1`, 'name');
  return body.map((entry) => String(entry.name));
}

afterEach(async () => {
  const { body } = await get<Entry[]>(env.techToken, `/api/issues/${env.issue}/customFields?$top=-1`, 'name,value');
  if (body.find((entry) => entry.name === WRITABLE)?.value !== WRITABLE_FIXTURE) {
    await restoreStringField(WRITABLE, WRITABLE_FIXTURE);
  }
});

describe('app-wide endpoints', () => {
  it('answer like the per-project endpoint', async () => {
    for (const query of ['', 'full=true', `fields=${encodeURIComponent(`${WRITABLE},Nope`)}`]) {
      const attached = await get<IssueBody>(env.userToken, query ? `${APP}?${query}` : APP);
      const global = await get<IssueBody>(env.userToken, query ? `${GLOBAL}&${query}` : GLOBAL);
      expect(global.status, query).toBe(200);
      expect(global.status, query).toBe(attached.status);
      same(global.body, attached.body);
      if (query.startsWith('fields')) expect(global.body.missing).toEqual(['Nope']);
    }
    const update = { field: WRITABLE, value: 'GLOBAL-1' };
    const attached = await post(env.userToken, APP, update);
    const global = await post(env.userToken, GLOBAL, update);
    expect(global.status).toBe(200);
    expect(global.status).toBe(attached.status);
    same(global.body, attached.body);
  });

  it('accept the database ID and a lower-case readable ID', async () => {
    const { body } = await get<{ id: string }>(env.adminToken, `/api/issues/${env.issue}`, 'id');
    for (const issueId of [body.id, env.issue.toLowerCase()]) {
      const response = await get<IssueBody>(env.userToken, `${GLOBAL_BASE}?issueId=${encodeURIComponent(issueId)}`);
      expect(response.status, issueId).toBe(200);
      expect(response.body.idReadable).toBe(env.issue);
    }
  });

  it('need issueId', async () => {
    const response = await get<{ error: string }>(env.userToken, GLOBAL_BASE);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('bad_request');
  });

  it("hide the issue from users who can't see the project", async () => {
    const read = await get(env.outsiderToken, GLOBAL);
    const write = await post(env.outsiderToken, GLOBAL, { field: WRITABLE, value: 'OUTSIDER' });
    for (const response of [read, write]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound(env.issue));
    }
  });

  it('work without attachment', async () => {
    cli('app', 'detach', '--app', 'hidden-fields', '--project', env.project);
    try {
      const global = await get<IssueBody>(env.userToken, GLOBAL);
      expect(global.status).toBe(200);
      expect(global.body.customFields.map((entry) => entry.name)).toContain(WRITABLE);
      expect((await get(env.userToken, APP)).status).toBe(404);
    } finally {
      cli('app', 'attach', '--app', 'hidden-fields', '--project', env.project);
    }
  });
});

describe('a group-restricted issue', () => {
  let issueId = '';

  beforeAll(async () => {
    const groups = await get<{ id: string; name: string }[]>(env.adminToken, '/api/groups?$top=-1', 'id,name');
    const group = groups.body.find((candidate) => candidate.name === env.group);
    const project = await get<{ id: string }>(env.adminToken, `/api/admin/projects/${env.project}`, 'id');
    if (!group) throw new Error(`group ${env.group} not found`);
    const created = await post<{ idReadable: string }>(env.adminToken, '/api/issues?fields=idReadable', {
      project: { id: project.body.id },
      summary: 'Restricted to the readers group',
      visibility: { $type: 'LimitedVisibility', permittedGroups: [{ id: group.id }] },
    });
    if (created.status !== 200) throw new Error(`could not create the restricted issue: HTTP ${created.status}`);
    issueId = created.body.idReadable;
  });

  afterAll(async () => {
    if (issueId) await remove(`/api/issues/${issueId}`);
  });

  it('is hidden from users outside the group', async () => {
    expect((await get(env.techToken, `/api/issues/${issueId}`, 'idReadable')).status).toBe(200);
    expect((await get(env.userToken, `/api/issues/${issueId}`, 'idReadable')).status).toBe(404);
    const url = `${GLOBAL_BASE}?issueId=${issueId}`;
    const read = await get(env.userToken, url);
    const write = await post(env.userToken, url, { field: WRITABLE, value: 'LEAK' });
    for (const response of [read, write]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound(issueId));
    }
  });
});

describe('a private field', () => {
  let fieldId = '';
  let projectFieldId = '';

  beforeAll(async () => {
    const existing = await get<{ id: string; name: string }[]>(
      env.adminToken,
      '/api/admin/customFieldSettings/customFields?$top=-1',
      'id,name',
    );
    const leftover = existing.body.find((field) => field.name === PRIVATE_FIELD);
    if (leftover) await remove(`/api/admin/customFieldSettings/customFields/${leftover.id}`);
    const field = await post<{ id: string }>(env.adminToken, '/api/admin/customFieldSettings/customFields?fields=id', {
      name: PRIVATE_FIELD,
      fieldType: { id: 'string' },
    });
    fieldId = field.body.id;
    const projectField = await post<{ id: string }>(
      env.adminToken,
      `/api/admin/projects/${env.project}/customFields?fields=id`,
      { $type: 'SimpleProjectCustomField', field: { id: fieldId }, isPublic: false },
    );
    projectFieldId = projectField.body.id;
    const set = await post(env.adminToken, `/api/issues/${env.issue}?fields=idReadable`, {
      customFields: [{ name: PRIVATE_FIELD, $type: 'SimpleIssueCustomField', value: 'PRIVATE-PROBE' }],
    });
    if (set.status !== 200) throw new Error(`could not set the private field: HTTP ${set.status}`);
  });

  afterAll(async () => {
    if (projectFieldId) await remove(`/api/admin/projects/${env.project}/customFields/${projectFieldId}`);
    if (fieldId) await remove(`/api/admin/customFieldSettings/customFields/${fieldId}`);
  });

  it("is left out for a caller who can't read it", async () => {
    expect(await fieldNames(env.techToken)).toContain(PRIVATE_FIELD);
    expect(await fieldNames(env.readerToken)).not.toContain(PRIVATE_FIELD);
    for (const query of ['', '&full=true']) {
      const { status, body } = await get<IssueBody>(env.readerToken, `${GLOBAL}${query}`);
      expect(status, query).toBe(200);
      expect(body.customFields.map((entry) => entry.name)).not.toContain(PRIVATE_FIELD);
      expect(JSON.stringify(body)).not.toContain('PRIVATE-PROBE');
    }
    const named = await get<IssueBody>(env.readerToken, `${GLOBAL}&fields=${encodeURIComponent(PRIVATE_FIELD)}`);
    expect(named.body.customFields).toEqual([]);
    expect(named.body.missing).toEqual([PRIVATE_FIELD]);
  });
});

describe('switches', () => {
  afterEach(async () => {
    await appSettings(null);
  });

  it('turn each interface off on its own', async () => {
    const keys: Switch[] = ['mcpEnabled', 'attachedRestEnabled', 'globalRestEnabled'];
    for (const key of keys) {
      await appSettings(null, { [key]: false });
      const attached = await get<{ error?: string }>(env.userToken, APP);
      const global = await get<{ error?: string }>(env.userToken, GLOBAL);
      const tool = await callToolRaw(env.userToken, 'hidden_fields_get_issue', { issueId: env.issue });
      expect(attached.status, key).toBe(key === 'attachedRestEnabled' ? 403 : 200);
      expect(global.status, key).toBe(key === 'globalRestEnabled' ? 403 : 200);
      if (key === 'attachedRestEnabled') expect(attached.body.error).toBe('disabled');
      if (key === 'globalRestEnabled') expect(global.body.error).toBe('disabled');
      expect(tool.isError, key).toBe(key === 'mcpEnabled');
      if (key === 'mcpEnabled') expect(tool.text).toContain(MCP_OFF);
    }
  });
});
