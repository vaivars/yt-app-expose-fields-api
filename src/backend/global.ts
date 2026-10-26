import type { Issue, User } from '@jetbrains/youtrack-scripting-api/entities';
import { notFound, type RestRequest, type RestResponse, readIssue, respond, writeIssue } from '../adapters/rest';
import { findIssue } from '../adapters/youtrack';
import { disabled, isEnabled } from '../core/switches';
import type { AppSettings } from '../core/types';

/** The parts of YouTrack's app-wide request context these endpoints use. */
export interface GlobalRequestContext {
  currentUser: User;
  settings: AppSettings;
  request: RestRequest;
  response: RestResponse;
}

/**
 * The issue named by `?issueId=`, if this endpoint is switched on and the caller can see the issue. The switch comes
 * first, so a switched-off endpoint answers the same for every issue. YouTrack checks nothing for app-wide endpoints,
 * so this is the only access check: an issue the caller can't see gets the same 404 as one that doesn't exist.
 */
function visibleIssue(ctx: GlobalRequestContext): Issue | null {
  if (!isEnabled(ctx.settings, 'globalRestDisabled')) {
    respond(ctx.response, disabled('globalRestDisabled'));
    return null;
  }
  const issueId = ctx.request.getParameter('issueId')?.trim() ?? '';
  if (!issueId) {
    respond(ctx.response, {
      status: 400,
      body: { error: 'bad_request', error_description: 'Name the issue with ?issueId=, for example ?issueId=ABC-1' },
    });
    return null;
  }
  const issue = findIssue(issueId);
  if (issue?.isVisibleTo(ctx.currentUser)) return issue;
  respond(ctx.response, notFound(issueId));
  return null;
}

/**
 * The same endpoints as api.ts, for issues in every project, whether or not the app is attached to it:
 * GET  /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1[&fields=Name1,Name2][&full=true]
 * POST /api/extensionEndpoints/hidden-fields/global/issue?issueId=ABC-1[&full=true]  {"field": "<name>", "value": <value>}
 */
export const httpHandler = {
  endpoints: [
    {
      method: 'GET',
      path: 'issue',
      scope: 'global',
      handle(ctx: GlobalRequestContext): void {
        const issue = visibleIssue(ctx);
        if (issue) respond(ctx.response, readIssue(issue, ctx.currentUser, ctx.settings, ctx.request));
      },
    },
    {
      method: 'POST',
      path: 'issue',
      scope: 'global',
      handle(ctx: GlobalRequestContext): void {
        const issue = visibleIssue(ctx);
        if (issue) respond(ctx.response, writeIssue(issue, ctx.currentUser, ctx.settings, ctx.request));
      },
    },
  ],
};
