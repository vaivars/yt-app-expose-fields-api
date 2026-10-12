import type { Issue, User } from '@jetbrains/youtrack-scripting-api/entities';
import { readInput, updateInput } from '../adapters/youtrack';
import { parseNames } from '../core/config';
import { getIssue, updateIssue } from '../core/issue';
import type { AppSettings, Result } from '../core/types';

/** The parts of YouTrack's issue-scoped request context these endpoints use. */
export interface IssueRequestContext {
  issue: Issue;
  currentUser: User;
  settings: AppSettings;
  /** YouTrack's runtime exposes request headers as a list; it has no getHeader(). */
  request: {
    body: string;
    headers?: { name: string; value: string }[];
    getParameter(name: string): string | undefined;
  };
  response: { code: number; json(data: unknown): void };
}

const BAD_BODY = 'The request body must be a JSON object like {"field": "<name>", "value": <value>}';

function respond(ctx: IssueRequestContext, result: Result): void {
  ctx.response.code = result.status;
  ctx.response.json(result.body);
}

/** YouTrack already checks issue access for issue-scoped endpoints; this keeps the app safe if that ever changes. */
function visible(ctx: IssueRequestContext): boolean {
  if (ctx.issue.isVisibleTo(ctx.currentUser)) return true;
  respond(ctx, {
    status: 404,
    body: { error: 'not_found', error_description: `Issue "${ctx.issue.id}" was not found` },
  });
  return false;
}

/**
 * Only JSON bodies are accepted. A browser can send text/plain, form and multipart bodies across origins without a
 * preflight, so accepting them would let another web page write fields with a signed-in user's session.
 */
function isJson(ctx: IssueRequestContext): boolean {
  let contentType = '';
  try {
    contentType = ctx.request.headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value ?? '';
  } catch {
    // treated as missing
  }
  return /^application\/json\s*(;|$)/i.test(contentType.trim());
}

/** The POST body as an object, or null. The body can only be read once. */
function jsonBody(ctx: IssueRequestContext): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(ctx.request.body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * GET  /api/issues/{id}/extensionEndpoints/hidden-fields/api/issue[?fields=Name1,Name2]
 * POST /api/issues/{id}/extensionEndpoints/hidden-fields/api/issue  {"field": "<name>", "value": <value>}
 */
export const httpHandler = {
  endpoints: [
    {
      method: 'GET',
      path: 'issue',
      scope: 'issue',
      handle(ctx: IssueRequestContext): void {
        if (!visible(ctx)) return;
        const fields = ctx.request.getParameter('fields');
        const names = fields ? [...parseNames(fields)] : null;
        respond(ctx, getIssue(readInput(ctx.issue, ctx.currentUser, ctx.settings, names)));
      },
    },
    {
      method: 'POST',
      path: 'issue',
      scope: 'issue',
      handle(ctx: IssueRequestContext): void {
        if (!visible(ctx)) return;
        if (!isJson(ctx)) {
          respond(ctx, {
            status: 415,
            body: { error: 'unsupported_media_type', error_description: 'Send the request body as application/json' },
          });
          return;
        }
        const body = jsonBody(ctx);
        if (!body) {
          respond(ctx, { status: 400, body: { error: 'bad_request', error_description: BAD_BODY } });
          return;
        }
        const value = Object.hasOwn(body, 'value') ? body.value : undefined;
        respond(ctx, updateIssue(updateInput(ctx.issue, ctx.currentUser, ctx.settings, body.field, value)));
      },
    },
  ],
};
