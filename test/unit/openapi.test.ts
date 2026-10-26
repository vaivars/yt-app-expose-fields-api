import { Validator } from '@seriousme/openapi-schema-validator';
import { beforeEach, describe, expect, it } from 'vitest';
import { httpHandler as attachedHandler } from '../../src/backend/api';
import { httpHandler as globalHandler } from '../../src/backend/global';
import { describeApi, type OpenApiDocument, type RestSwitches } from '../../src/core/openapi';
import type { AppSettings } from '../../src/core/types';
import { type Call, callAttached, callGlobal, resetYouTrack, SCENARIOS } from '../fakes/handlers';
import { issueRegistry } from '../fakes/scripting-api/entities';
import { fakeIssue } from '../fakes/youtrack';

type Json = Record<string, unknown>;

const ALL: RestSwitches = { attached: true, global: true };
const COMBOS: RestSwitches[] = [
  ALL,
  { attached: true, global: false },
  { attached: false, global: true },
  { attached: false, global: false },
];
const GLOBAL_PATH = '/api/extensionEndpoints/hidden-fields/global/issue';
const ATTACHED_PATH = '/api/issues/{id}/extensionEndpoints/hidden-fields/api/issue';
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const UPDATE = '{"field":"External ID","value":"X"}';
const SETTINGS: AppSettings = { exposedFields: 'External ID', serviceToken: 'perm:t' };

const doc = describeApi('1.2.3', ALL);

function pathItem(document: OpenApiDocument, path: string): Json {
  return document.paths[path] as unknown as Json;
}

function operation(path: string, method: string): Json {
  return pathItem(doc, path)[method] as Json;
}

function operations(document: OpenApiDocument): { path: string; method: string; operation: Json }[] {
  return Object.keys(document.paths).flatMap((path) =>
    METHODS.filter((method) => pathItem(document, path)[method]).map((method) => ({
      path,
      method,
      operation: pathItem(document, path)[method] as Json,
    })),
  );
}

/** Calls `visit` for every key of every object in `value`, depth first. */
function walk(value: unknown, visit: (key: string, child: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child);
      walk(child, visit);
    }
  }
}

function queryNames(path: string, method: string): string[] {
  const parameters = [
    ...((pathItem(doc, path).parameters as Json[] | undefined) ?? []),
    ...((operation(path, method).parameters as Json[] | undefined) ?? []),
  ];
  return parameters
    .filter((parameter) => parameter.in === 'query')
    .map((parameter) => String(parameter.name))
    .sort();
}

/** The described path of a handler endpoint in `src/backend/<file>.ts`. */
function describedPath(file: string, scope: string, path: string): string {
  if (scope === 'issue') return `/api/issues/{id}/extensionEndpoints/hidden-fields/${file}/${path}`;
  if (scope === 'global') return `/api/extensionEndpoints/hidden-fields/${file}/${path}`;
  throw new Error(`no URL rule for scope ${scope}`);
}

beforeEach(() => {
  resetYouTrack();
  issueRegistry.clear();
});

describe('describeApi', () => {
  it('is OpenAPI 3.1.0 with the app version and id', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Hidden Fields API');
    expect(doc.info.version).toBe('1.2.3');
    expect(doc.info['x-youtrack-app']).toEqual({ id: 'hidden-fields' });
  });

  it('is a valid OpenAPI 3.1 document for every switch combination', async () => {
    for (const combo of COMBOS) {
      const result = await new Validator().validate(describeApi('1.2.3', combo) as never);
      expect(result.valid, `${JSON.stringify(combo)}: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });

  it('lists only the switched-on endpoints', () => {
    expect(COMBOS.map((combo) => Object.keys(describeApi('1.2.3', combo).paths).sort())).toEqual([
      [ATTACHED_PATH, GLOBAL_PATH].sort(),
      [ATTACHED_PATH],
      [GLOBAL_PATH],
      [],
    ]);
    for (const combo of COMBOS) expect(describeApi('1.2.3', combo).components).toStrictEqual(doc.components);
  });

  it('resolves servers to the YouTrack base URL, with or without a context path', () => {
    for (const base of ['https://yt.example/', 'https://yt.example/youtrack/']) {
      const url = new URL(doc.servers[0]?.url ?? '', `${base}api/extensionEndpoints/hidden-fields/meta/openapi.json`);
      expect(url.href).toBe(base);
    }
  });

  it('survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(doc);
  });

  it('resolves every $ref', () => {
    const refs: string[] = [];
    walk(doc, (key, child) => {
      if (key === '$ref') refs.push(String(child));
    });
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = /^#\/components\/schemas\/(\w+)$/.exec(ref)?.[1];
      expect(name, ref).toBeDefined();
      expect(doc.components.schemas[name ?? ''], ref).toBeDefined();
    }
  });

  it('uses bearer auth', () => {
    expect(doc.security).toEqual([{ bearer: [] }]);
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('marks the issue parameters and scopes', () => {
    expect(pathItem(doc, GLOBAL_PATH)['x-youtrack-scope']).toBe('global');
    expect(pathItem(doc, GLOBAL_PATH).parameters).toContainEqual(
      expect.objectContaining({ name: 'issueId', in: 'query', required: true, 'x-youtrack-entity': 'issue' }),
    );
    expect(pathItem(doc, ATTACHED_PATH)['x-youtrack-scope']).toBe('issue');
    expect(pathItem(doc, ATTACHED_PATH).parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true, 'x-youtrack-entity': 'issue' }),
    );
  });

  it('names the operations', () => {
    const ids = operations(doc).map(({ operation: op }) => String(op.operationId));
    expect([...ids].sort()).toEqual(['get-issue', 'get-issue-attached', 'update-issue', 'update-issue-attached']);
    expect(operation(GLOBAL_PATH, 'get').operationId).toBe('get-issue');
    expect(operation(GLOBAL_PATH, 'post').operationId).toBe('update-issue');
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('never forbids additional properties', () => {
    walk(doc.components.schemas, (key, child) => {
      if (key === 'additionalProperties') expect(child).not.toBe(false);
    });
  });

  it('requires the error, update request and update status fields', () => {
    const schemas = doc.components.schemas as Record<string, Json>;
    expect(schemas.Error?.required).toEqual(['error', 'error_description']);
    expect(schemas.UpdateRequest?.required).toEqual(['field', 'value']);
    expect(schemas.UpdateStatus?.required).toEqual(['idReadable', 'field', 'status']);
  });
});

describe('description matches the REST handlers', () => {
  it('describes exactly the endpoints the handlers serve', () => {
    const served = [
      ...attachedHandler.endpoints.map((endpoint) => ({ file: 'api', ...endpoint })),
      ...globalHandler.endpoints.map((endpoint) => ({ file: 'global', ...endpoint })),
    ].map(
      (endpoint) => `${endpoint.method.toLowerCase()} ${describedPath(endpoint.file, endpoint.scope, endpoint.path)}`,
    );
    const described = operations(doc).map(({ path, method }) => `${method} ${path}`);
    expect(described.sort()).toEqual(served.sort());
  });

  it('documents exactly the query parameters each operation reads', () => {
    const asked = (call: Call) => [...new Set(call.asked)].sort();
    const read = { params: { fields: 'Priority', full: 'true' } };
    const write = { params: { full: 'true' }, body: UPDATE };
    expect(asked(callAttached('GET', read))).toEqual(queryNames(ATTACHED_PATH, 'get'));
    expect(asked(callAttached('POST', write))).toEqual(queryNames(ATTACHED_PATH, 'post'));
    expect(asked(callGlobal('GET', read))).toEqual(queryNames(GLOBAL_PATH, 'get'));
    expect(asked(callGlobal('POST', write))).toEqual(queryNames(GLOBAL_PATH, 'post'));
    expect(queryNames(ATTACHED_PATH, 'get')).toEqual(['fields', 'full']);
    expect(queryNames(GLOBAL_PATH, 'post')).toEqual(['full', 'issueId']);
  });

  it('documents exactly the statuses each operation can return', () => {
    const codes: Record<string, Set<string>> = {};
    const record = (path: string, method: string, call: Call) => {
      const key = `${method} ${path}`;
      codes[key] ??= new Set(['401']);
      codes[key].add(String(call.code));
    };
    for (const scenario of SCENARIOS) {
      const method = scenario.method.toLowerCase();
      resetYouTrack(scenario.respond);
      record(ATTACHED_PATH, method, callAttached(scenario.method, scenario.options));
      resetYouTrack(scenario.respond);
      record(GLOBAL_PATH, method, callGlobal(scenario.method, scenario.options));
    }
    issueRegistry.set('HIDDEN-1', fakeIssue({ id: 'HIDDEN-1', visible: false }));
    for (const method of ['GET', 'POST']) {
      for (const issueId of [null, 'NOPE-1', 'HIDDEN-1']) {
        record(GLOBAL_PATH, method.toLowerCase(), callGlobal(method, { issueId, body: UPDATE }));
      }
      const attachedOff = { body: UPDATE, settings: { ...SETTINGS, attachedRestDisabled: true } };
      const globalOff = { body: UPDATE, settings: { ...SETTINGS, globalRestDisabled: true } };
      record(ATTACHED_PATH, method.toLowerCase(), callAttached(method, attachedOff));
      record(GLOBAL_PATH, method.toLowerCase(), callGlobal(method, globalOff));
    }
    for (const { path, method, operation: op } of operations(doc)) {
      const documented = Object.keys(op.responses as Json).sort();
      expect([...(codes[`${method} ${path}`] ?? [])].sort(), `${method} ${path}`).toEqual(documented);
    }
    expect(Object.keys(operation(GLOBAL_PATH, 'get').responses as Json).sort()).toEqual(
      ['200', '400', '401', '403', '404', '500', '502'].sort(),
    );
    expect(Object.keys(operation(GLOBAL_PATH, 'post').responses as Json).sort()).toEqual(
      ['200', '400', '401', '403', '404', '415', '500', '502'].sort(),
    );
  });
});
