import { describe, expect, it } from 'vitest';
import type { HttpConnectionLike, HttpResponseLike } from '../../src/core/types';
import { callYouTrack, issuePath } from '../../src/core/upstream';

const TOKEN = 'perm:secret-token';

function connection(response: HttpResponseLike | Error) {
  const calls: {
    token?: string;
    headers: [string, string][];
    method?: string;
    uri?: string;
    query?: unknown;
    payload?: string;
  } = {
    headers: [],
  };
  const answer = (): HttpResponseLike => {
    if (response instanceof Error) throw response;
    return response;
  };
  const conn: HttpConnectionLike = {
    bearerAuth(token) {
      calls.token = token;
      return conn;
    },
    addHeader(name, value) {
      calls.headers.push([name, value]);
      return conn;
    },
    getSync(uri, query) {
      Object.assign(calls, { method: 'GET', uri, query });
      return answer();
    },
    postSync(uri, query, payload) {
      Object.assign(calls, { method: 'POST', uri, query, payload });
      return answer();
    },
  };
  return { conn, calls };
}

const upstream = (conn: HttpConnectionLike) => ({ connect: () => conn, baseUrl: 'https://yt.example', token: TOKEN });

describe('issuePath', () => {
  it('encodes the issue id', () => {
    expect(issuePath('A B/1', '/customFields')).toBe('/api/issues/A%20B%2F1/customFields');
    expect(issuePath('ABC-1')).toBe('/api/issues/ABC-1');
  });
});

describe('callYouTrack', () => {
  it('GETs as the technical user and parses JSON', () => {
    const { conn, calls } = connection({ code: 200, response: '[{"name":"A"}]' });
    let connectedTo = '';
    const result = callYouTrack(
      {
        ...upstream(conn),
        connect: (url) => {
          connectedTo = url;
          return conn;
        },
      },
      { method: 'GET', path: '/api/issues/ABC-1/customFields', query: { fields: 'name' } },
    );
    expect(result).toEqual({ ok: true, json: [{ name: 'A' }] });
    expect(connectedTo).toBe('https://yt.example');
    expect(calls).toEqual({
      token: TOKEN,
      headers: [],
      method: 'GET',
      uri: '/api/issues/ABC-1/customFields',
      query: { fields: 'name' },
    });
  });

  it('POSTs a JSON payload with a JSON content type', () => {
    const { conn, calls } = connection({ code: 200, response: '{"idReadable":"ABC-1"}' });
    const payload = { customFields: [{ name: 'A', $type: 'SimpleIssueCustomField', value: 'x' }] };
    const result = callYouTrack(upstream(conn), { method: 'POST', path: '/api/issues/ABC-1', query: {}, payload });
    expect(result).toEqual({ ok: true, json: { idReadable: 'ABC-1' } });
    expect(calls.headers).toEqual([['Content-Type', 'application/json']]);
    expect(calls.method).toBe('POST');
    expect(JSON.parse(calls.payload ?? '')).toEqual(payload);
  });

  it("passes a 400 through with YouTrack's error, naming it bad_request when YouTrack leaves it empty", () => {
    const named = connection({ code: 400, response: '{"error":"invalid_query","error_description":"Bad fields"}' });
    expect(callYouTrack(upstream(named.conn), { method: 'GET', path: '/x', query: {} })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'invalid_query', error_description: 'Bad fields' },
    });
    const empty = connection({ code: 400, response: '{"error":"","error_description":"Incompatible value format"}' });
    expect(callYouTrack(upstream(empty.conn), { method: 'POST', path: '/x', query: {}, payload: {} })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'bad_request', error_description: 'Incompatible value format' },
    });
  });

  it('turns a 400 with a body that is not a YouTrack error into a generic bad_request', () => {
    const { conn } = connection({ code: 400, response: '<html>Bad Request</html>' });
    expect(callYouTrack(upstream(conn), { method: 'GET', path: '/x', query: {} })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'bad_request', error_description: 'YouTrack rejected the request' },
    });
  });

  it('maps every other failure status to 502 without the token or the upstream body', () => {
    for (const code of [0, 302, 401, 403, 404, 500, 503]) {
      const { conn } = connection({ code, response: `token ${TOKEN} is invalid` });
      const result = callYouTrack(upstream(conn), { method: 'GET', path: '/x', query: {} });
      expect(result).toEqual({
        ok: false,
        status: 502,
        body: { error: 'upstream_error', error_description: `technical user request failed (HTTP ${code})` },
      });
      expect(JSON.stringify(result)).not.toContain('secret-token');
    }
  });

  it('maps a thrown connection error to 502 without its message', () => {
    const { conn } = connection(new Error(`connect timed out for ${TOKEN}`));
    const result = callYouTrack(upstream(conn), { method: 'POST', path: '/x', query: {}, payload: {} });
    expect(result).toEqual({
      ok: false,
      status: 502,
      body: { error: 'upstream_error', error_description: 'technical user request failed (no response)' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('maps a success body that is not JSON to 502', () => {
    const { conn } = connection({ code: 200, response: '<html>login</html>' });
    expect(callYouTrack(upstream(conn), { method: 'GET', path: '/x', query: {} })).toEqual({
      ok: false,
      status: 502,
      body: { error: 'upstream_error', error_description: 'technical user request returned an unexpected body' },
    });
  });
});
