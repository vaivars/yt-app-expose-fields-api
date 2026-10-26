import { beforeEach, describe, expect, it } from 'vitest';
import { notFound } from '../../src/adapters/rest';
import { httpHandler } from '../../src/backend/global';
import { callAttached, callGlobal, resetYouTrack, SCENARIOS } from '../fakes/handlers';
import { issueRegistry } from '../fakes/scripting-api/entities';
import { httpFake } from '../fakes/scripting-api/http';
import { fakeIssue } from '../fakes/youtrack';

const UPDATE = '{"field":"External ID","value":"X"}';

beforeEach(() => {
  resetYouTrack();
  issueRegistry.clear();
});

describe('app-wide httpHandler', () => {
  it('declares GET and POST on the app-wide path issue', () => {
    expect(httpHandler.endpoints.map((endpoint) => [endpoint.method, endpoint.scope, endpoint.path])).toEqual([
      ['GET', 'global', 'issue'],
      ['POST', 'global', 'issue'],
    ]);
  });

  it('answers exactly like the per-project endpoint', () => {
    for (const scenario of SCENARIOS) {
      resetYouTrack(scenario.respond);
      const attached = callAttached(scenario.method, scenario.options);
      resetYouTrack(scenario.respond);
      const global = callGlobal(scenario.method, scenario.options);
      const label = `${scenario.method} ${scenario.name}`;
      expect(global.code, label).toBe(attached.code);
      expect(global.body, label).toStrictEqual(attached.body);
    }
  });

  it('needs issueId', () => {
    for (const method of ['GET', 'POST']) {
      for (const issueId of [null, '', '  ']) {
        const response = callGlobal(method, { issueId, body: UPDATE });
        expect(response.code, `${method} ${issueId}`).toBe(400);
        expect((response.body as { error: string }).error).toBe('bad_request');
      }
    }
    expect(httpFake.calls).toEqual([]);
  });

  it('trims issueId', () => {
    expect(callGlobal('GET', { issueId: ' ABC-1 ' }).code).toBe(200);
  });

  it('reports unknown, invisible and broken lookups the same way', () => {
    issueRegistry.set('HIDDEN-1', fakeIssue({ id: 'HIDDEN-1', visible: false }));
    issueRegistry.set('BAD', new Error('Invalid issue id'));
    for (const method of ['GET', 'POST']) {
      for (const issueId of ['NOPE-1', 'HIDDEN-1', 'BAD']) {
        const response = callGlobal(method, { issueId, body: UPDATE });
        expect(response.code, `${method} ${issueId}`).toBe(404);
        expect(response.body).toEqual(notFound(issueId).body);
      }
    }
    expect(httpFake.calls).toEqual([]);
  });

  it('looks up the issue before checking the request', () => {
    expect(callGlobal('POST', { issueId: null, body: UPDATE, contentType: 'text/plain' }).code).toBe(400);
    expect(callGlobal('POST', { issueId: 'NOPE-1', body: UPDATE, contentType: 'text/plain' }).code).toBe(404);
  });
});
