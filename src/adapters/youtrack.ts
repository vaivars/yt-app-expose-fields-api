import { Issue, type User } from '@jetbrains/youtrack-scripting-api/entities';
import { Connection } from '@jetbrains/youtrack-scripting-api/http';
import type { AppSettings, HttpConnectionLike, IssueContext, ReadInput, UpdateInput } from '../core/types';

/** Milliseconds to wait for YouTrack's own REST API. */
export const UPSTREAM_TIMEOUT_MS = 10_000;

export function connect(baseUrl: string): HttpConnectionLike {
  return new Connection(baseUrl, null, UPSTREAM_TIMEOUT_MS);
}

/** The issue with this readable or database ID, or null when there's none or the ID is malformed. */
export function findIssue(issueId: string): Issue | null {
  try {
    return Issue.findById(issueId) ?? null;
  } catch {
    return null;
  }
}

/** Messages land in the app's log (Administration → Apps → Hidden Fields API → Logs). */
const appLog = { info: (message: string) => console.log(message), warn: (message: string) => console.warn(message) };

function issueContext(issue: Issue, user: User, settings: AppSettings, full: boolean): IssueContext {
  return { issueId: issue.id, issueUrl: issue.url, settings, user, connect, full };
}

/** Input for get_issue; the readability check runs as the calling user. */
export function readInput(
  issue: Issue,
  user: User,
  settings: AppSettings,
  names: string[] | null,
  full: boolean,
): ReadInput {
  return {
    ...issueContext(issue, user, settings, full),
    names,
    canRead: (fieldName) => issue.fields.canBeReadBy(fieldName, user),
    projectFieldNames: () => {
      const fieldNames: string[] = [];
      issue.project.fields.forEach((field) => {
        fieldNames.push(field.name);
      });
      return fieldNames;
    },
    log: appLog,
  };
}

/** Input for update_issue; the caller needs the Update Issue permission in the issue's project. */
export function updateInput(
  issue: Issue,
  user: User,
  settings: AppSettings,
  field: unknown,
  value: unknown,
  full: boolean,
): UpdateInput {
  return {
    ...issueContext(issue, user, settings, full),
    actor: user.login,
    field,
    value,
    canUpdate: () => user.hasPermission('UPDATE_ISSUE', issue.project),
    log: appLog,
  };
}
