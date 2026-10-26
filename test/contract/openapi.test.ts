import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020';
import { afterEach, describe, expect, it } from 'vitest';
import { describeApi, type RestSwitches } from '../../src/core/openapi.ts';
import { appSettings, type Entry, get, post, restoreStringField } from './client.ts';
import { contractEnv as env } from './env.ts';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8')) as { version: string };
const DOC = '/api/extensionEndpoints/hidden-fields/meta/openapi.json';
const GLOBAL_PATH = '/api/extensionEndpoints/hidden-fields/global/issue';
const ATTACHED_PATH = '/api/issues/{id}/extensionEndpoints/hidden-fields/api/issue';
const ALL: RestSwitches = { attached: true, global: true };
const WRITABLE = 'HF External ID';
const WRITABLE_FIXTURE = 'EXT-42';

/** Each described path with the real URL of the test issue and the switch that turns it off. */
const ENDPOINTS = [
  { path: GLOBAL_PATH, url: `${GLOBAL_PATH}?issueId=${env.issue}`, off: { globalRestEnabled: false } },
  {
    path: ATTACHED_PATH,
    url: ATTACHED_PATH.replace('{id}', env.issue),
    off: { attachedRestEnabled: false },
  },
];

function expected(rest: RestSwitches) {
  return describeApi(manifest.version, rest);
}

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(expected(ALL), 'doc');

/** Checks the status, then the body against the schema the description gives for that path, method and status. */
function matches(path: string, method: string, response: { status: number; body: unknown }, status: number): void {
  const label = `${method} ${path} ${status}`;
  expect(response.status, label).toBe(status);
  const operation = (expected(ALL).paths[path] as unknown as Record<string, Record<string, unknown>>)[method];
  const responses = operation?.responses as Record<string, { content: Record<string, { schema: unknown }> }>;
  const schema = responses[String(status)]?.content['application/json']?.schema;
  expect(schema, label).toBeDefined();
  const local = JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"doc#/components/'));
  expect(ajv.validate(local, response.body), `${label}: ${ajv.errorsText()}`).toBe(true);
}

afterEach(async () => {
  const { body } = await get<Entry[]>(env.techToken, `/api/issues/${env.issue}/customFields?$top=-1`, 'name,value');
  if (body.find((entry) => entry.name === WRITABLE)?.value !== WRITABLE_FIXTURE) {
    await restoreStringField(WRITABLE, WRITABLE_FIXTURE);
  }
});

describe('meta/openapi.json', () => {
  it('serves the description to any logged-in user', async () => {
    for (const token of [env.userToken, env.outsiderToken]) {
      const { status, body } = await get(token, DOC);
      expect(status).toBe(200);
      expect(body).toEqual(expected(ALL));
    }
  });

  it('rejects requests without a token, as the description says', async () => {
    for (const url of [DOC, ENDPOINTS[0]?.url ?? '']) {
      const response = await fetch(`${env.url}${url}`, { headers: { Accept: 'application/json' } });
      expect(response.status, url).toBe(401);
      if (url !== DOC) matches(GLOBAL_PATH, 'get', { status: 401, body: await response.json() }, 401);
    }
  });

  it('lists only the switched-on REST endpoints', async () => {
    try {
      for (const [switches, rest] of [
        [{ attachedRestEnabled: false }, { attached: false, global: true }],
        [{ globalRestEnabled: false }, { attached: true, global: false }],
        [
          { attachedRestEnabled: false, globalRestEnabled: false },
          { attached: false, global: false },
        ],
      ] as const) {
        await appSettings(null, switches);
        expect((await get(env.userToken, DOC)).body, JSON.stringify(rest)).toEqual(expected(rest));
      }
    } finally {
      await appSettings(null);
    }
  });
});

describe('real responses match the description', () => {
  for (const { path, url, off } of ENDPOINTS) {
    describe(path, () => {
      it('get-issue: compact, full and named fields', async () => {
        const join = url.includes('?') ? '&' : '?';
        for (const query of ['', `${join}full=true`, `${join}fields=${encodeURIComponent(`${WRITABLE},Nope`)}`]) {
          matches(path, 'get', await get(env.userToken, `${url}${query}`), 200);
        }
      });

      it('update-issue: success, wrong content type and an unexposed field', async () => {
        matches(path, 'post', await post(env.userToken, url, { field: WRITABLE, value: 'OPENAPI-1' }), 200);
        matches(path, 'post', await post(env.userToken, url, { field: WRITABLE, value: 'x' }, 'text/plain'), 415);
        matches(path, 'post', await post(env.userToken, url, { field: env.unexposed, value: null }), 403);
      });

      it('a switched-off endpoint', async () => {
        try {
          await appSettings(null, off);
          const response = await get<{ error: string }>(env.userToken, url);
          matches(path, 'get', response, 403);
          expect(response.body.error).toBe('disabled');
        } finally {
          await appSettings(null);
        }
      });
    });
  }
});
