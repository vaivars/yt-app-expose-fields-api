import type { Issue, User } from '@jetbrains/youtrack-scripting-api/entities';
import { listNames } from '../core/config';
import type { AppSettings, ErrorBody, IssueObject, Result } from '../core/types';
import { findIssue } from './youtrack';

/** The parts of YouTrack's AI tool context the tools use. */
export interface ToolContext {
  arguments: Record<string, unknown>;
  currentUser: User;
  settings: AppSettings;
}

/** The issue named by `issueId` if the caller can see it; anything else is "not found". */
export function visibleIssue(ctx: ToolContext): Issue {
  const issueId = typeof ctx.arguments.issueId === 'string' ? ctx.arguments.issueId.trim() : '';
  const issue = issueId ? findIssue(issueId) : null;
  if (!issue || !issue.isVisibleTo(ctx.currentUser)) throw new Error(`Issue "${issueId}" was not found`);
  return issue;
}

/** Field names from a list or a comma-separated string; null when none were given. */
export function namesArgument(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((name): name is string => typeof name === 'string');
  if (typeof value === 'string') return listNames(value);
  return null;
}

/** The result body, or a thrown tool error. */
export function toolResult(result: Result): IssueObject {
  if (result.status !== 200) {
    const error = result.body as ErrorBody;
    throw new Error(`${error.error}: ${error.error_description}`);
  }
  return result.body as IssueObject;
}
