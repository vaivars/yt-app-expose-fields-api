import type { ErrorBody, HttpConnectionLike, HttpResponseLike } from './types';

export interface Upstream {
  connect(baseUrl: string): HttpConnectionLike;
  baseUrl: string;
  token: string;
}

export interface UpstreamRequest {
  method: 'GET' | 'POST';
  path: string;
  query: Record<string, string>;
  payload?: unknown;
}

export type UpstreamResult = { ok: true; json: unknown } | { ok: false; status: number; body: ErrorBody };

export function issuePath(issueId: string, suffix = ''): string {
  return `/api/issues/${encodeURIComponent(issueId)}${suffix}`;
}

/**
 * Calls YouTrack's REST API with the technical user's token. Failures never include the token or the upstream body,
 * except YouTrack's own message for a 400 (an invalid value, for example).
 */
export function callYouTrack(upstream: Upstream, request: UpstreamRequest): UpstreamResult {
  let response: HttpResponseLike;
  try {
    const connection = upstream.connect(upstream.baseUrl);
    connection.bearerAuth(upstream.token);
    if (request.method === 'GET') {
      response = connection.getSync(request.path, request.query);
    } else {
      connection.addHeader('Content-Type', 'application/json');
      response = connection.postSync(request.path, request.query, JSON.stringify(request.payload));
    }
  } catch {
    return upstreamError('technical user request failed (no response)');
  }
  if (response.code === 400) return { ok: false, status: 400, body: youTrackError(response.response) };
  if (response.code < 200 || response.code >= 300) {
    return upstreamError(`technical user request failed (HTTP ${response.code})`);
  }
  try {
    return { ok: true, json: JSON.parse(response.response) };
  } catch {
    return upstreamError('technical user request returned an unexpected body');
  }
}

export function upstreamError(description: string): { ok: false; status: number; body: ErrorBody } {
  return { ok: false, status: 502, body: { error: 'upstream_error', error_description: description } };
}

function youTrackError(raw: string): ErrorBody {
  try {
    const parsed = JSON.parse(raw) as Partial<ErrorBody>;
    if (typeof parsed.error_description === 'string' || typeof parsed.error === 'string') {
      return {
        error: typeof parsed.error === 'string' && parsed.error ? parsed.error : 'bad_request',
        error_description: typeof parsed.error_description === 'string' ? parsed.error_description : '',
      };
    }
  } catch {
    // not a YouTrack error body
  }
  return { error: 'bad_request', error_description: 'YouTrack rejected the request' };
}
