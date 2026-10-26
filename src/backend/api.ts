import type { Issue, User } from '@jetbrains/youtrack-scripting-api/entities';
import { notFound, type RestRequest, type RestResponse, readIssue, respond, writeIssue } from '../adapters/rest';
import type { AppSettings } from '../core/types';

/** The parts of YouTrack's issue-scoped request context these endpoints use. */
export interface IssueRequestContext {
  issue: Issue;
  currentUser: User;
  settings: AppSettings;
  request: RestRequest;
  response: RestResponse;
}

/** YouTrack already checks issue access for issue-scoped endpoints; this keeps the app safe if that ever changes. */
function visible(ctx: IssueRequestContext): boolean {
  if (ctx.issue.isVisibleTo(ctx.currentUser)) return true;
  respond(ctx.response, notFound(ctx.issue.id));
  return false;
}

/**
 * GET  /api/issues/{id}/extensionEndpoints/hidden-fields/api/issue[?fields=Name1,Name2][&full=true]
 * POST /api/issues/{id}/extensionEndpoints/hidden-fields/api/issue[?full=true]  {"field": "<name>", "value": <value>}
 */
export const httpHandler = {
  endpoints: [
    {
      method: 'GET',
      path: 'issue',
      scope: 'issue',
      handle(ctx: IssueRequestContext): void {
        if (!visible(ctx)) return;
        respond(ctx.response, readIssue(ctx.issue, ctx.currentUser, ctx.settings, ctx.request));
      },
    },
    {
      method: 'POST',
      path: 'issue',
      scope: 'issue',
      handle(ctx: IssueRequestContext): void {
        if (!visible(ctx)) return;
        respond(ctx.response, writeIssue(ctx.issue, ctx.currentUser, ctx.settings, ctx.request));
      },
    },
  ],
};
