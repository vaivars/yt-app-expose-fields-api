import type { Issue, User } from '@jetbrains/youtrack-scripting-api/entities';
import { listNames } from '../core/config';
import { getIssue, updateIssue } from '../core/issue';
import type { AppSettings, Result } from '../core/types';
import { readInput, updateInput } from './youtrack';

/** The parts of YouTrack's HTTP request the REST endpoints use. */
export interface RestRequest {
  body: string;
  /** YouTrack's runtime exposes request headers as a list; it has no getHeader(). */
  headers?: { name: string; value: string }[];
  getParameter(name: string): string | undefined;
}

export interface RestResponse {
  code: number;
  json(data: unknown): void;
}

const BAD_BODY = 'The request body must be a JSON object like {"field": "<name>", "value": <value>}';

export function respond(response: RestResponse, result: Result): void {
  response.code = result.status;
  response.json(result.body);
}

/** The same answer for an issue that doesn't exist and one the caller can't see. */
export function notFound(issueId: string): Result {
  return { status: 404, body: { error: 'not_found', error_description: `Issue "${issueId}" was not found` } };
}

/** get_issue: `?fields=Name1,Name2` narrows the custom fields, `?full=true` asks for YouTrack's full output. */
export function readIssue(issue: Issue, user: User, settings: AppSettings, request: RestRequest): Result {
  const fields = request.getParameter('fields');
  const names = fields ? listNames(fields) : null;
  return getIssue(readInput(issue, user, settings, names, full(request)));
}

/** update_issue: `{"field": "<name>", "value": <value>}` as JSON. */
export function writeIssue(issue: Issue, user: User, settings: AppSettings, request: RestRequest): Result {
  if (!isJson(request)) {
    return {
      status: 415,
      body: { error: 'unsupported_media_type', error_description: 'Send the request body as application/json' },
    };
  }
  const body = jsonBody(request);
  if (!body) return { status: 400, body: { error: 'bad_request', error_description: BAD_BODY } };
  const value = Object.hasOwn(body, 'value') ? body.value : undefined;
  return updateIssue(updateInput(issue, user, settings, body.field, value, full(request)));
}

/**
 * Only JSON bodies are accepted. A browser can send text/plain, form and multipart bodies across origins without a
 * preflight, so accepting them would let another web page write fields with a signed-in user's session.
 */
function isJson(request: RestRequest): boolean {
  let contentType = '';
  try {
    contentType = request.headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value ?? '';
  } catch {
    // treated as missing
  }
  return /^application\/json\s*(;|$)/i.test(contentType.trim());
}

/** `?full=true` asks for YouTrack's full output instead of the compact default. */
function full(request: RestRequest): boolean {
  return request.getParameter('full')?.trim().toLowerCase() === 'true';
}

/** The POST body as an object, or null. The body can only be read once. */
function jsonBody(request: RestRequest): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(request.body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
