import { canUseExposedFields } from './access';
import { deriveBaseUrl, normalizeName, parseNames } from './config';
import { FULL_PROJECTION, ISSUE_PROJECTION } from './projection';
import type { CustomFieldEntry, ErrorBody, IssueContext, IssueObject, ReadInput, Result, UpdateInput } from './types';
import { callYouTrack, issuePath, type Upstream, upstreamError } from './upstream';

/**
 * get_issue: the ticket in YouTrack's REST shape with every custom field the caller can read plus the exposed ones,
 * or, when names are requested, only those fields.
 */
export function getIssue(input: ReadInput): Result {
  const upstream = upstreamFor(input);
  if ('status' in upstream) return upstream;

  const exposedAllowed = canUseExposedFields(input.settings.allowedGroup, input.user);
  const exposed = exposedAllowed ? parseNames(input.settings.exposedFields) : new Set<string>();
  const only = requestedNames(input.names);
  const wanted = (name: string): boolean =>
    (only === null || only.has(normalizeName(name))) && (exposed.has(normalizeName(name)) || readable(input, name));

  const fields = fetchFields(upstream, input.issueId, FULL_PROJECTION);
  if (!Array.isArray(fields)) return fields;

  const returned = new Set<string>();
  const kept: CustomFieldEntry[] = [];
  for (const entry of fields) {
    const name = entryName(entry);
    returned.add(normalizeName(name));
    if (wanted(name)) kept.push(entry);
  }
  for (const name of input.projectFieldNames()) {
    if (!returned.has(normalizeName(name)) && wanted(name)) {
      input.log.warn(`Field "${name}" exists in the project but the technical user cannot read it`);
    }
  }

  if (only !== null) return issueBody({ idReadable: input.issueId }, kept);

  const base = callYouTrack(upstream, {
    method: 'GET',
    path: issuePath(input.issueId),
    query: { fields: ISSUE_PROJECTION },
  });
  if (!base.ok) return { status: base.status, body: base.body };
  if (!isObject(base.json)) return failure(upstreamError('technical user request returned an unexpected body'));
  return issueBody(base.json, kept);
}

/** update_issue: sets one exposed field as the technical user and returns its fresh entry. */
export function updateIssue(input: UpdateInput): Result {
  const field = typeof input.field === 'string' ? input.field.trim() : '';
  if (!field) return error(400, 'bad_request', 'field is required');
  if (input.value === undefined) return error(400, 'bad_request', 'value is required; use null to clear the field');
  if (!canUseExposedFields(input.settings.allowedGroup, input.user)) {
    return error(403, 'forbidden', 'You are not allowed to update the exposed fields of this issue');
  }
  if (!allowed(input.canUpdate)) return error(403, 'forbidden', 'You are not allowed to update this issue');
  if (!parseNames(input.settings.exposedFields).has(normalizeName(field))) {
    return error(403, 'forbidden', `"${field}" is not an exposed field`);
  }

  const upstream = upstreamFor(input);
  if ('status' in upstream) return upstream;

  const current = fetchFields(upstream, input.issueId, '$type,name');
  if (!Array.isArray(current)) return current;
  const target = current.find((entry) => normalizeName(entryName(entry)) === normalizeName(field));
  if (!target) return error(404, 'not_found', `Field "${field}" was not found on this issue`);

  const written = callYouTrack(upstream, {
    method: 'POST',
    path: issuePath(input.issueId),
    query: { fields: 'idReadable' },
    payload: { customFields: [{ name: target.name, $type: target.$type, value: input.value }] },
  });
  if (!written.ok) return { status: written.status, body: written.body };
  input.log.info(`update_issue: ${input.actor} set "${String(target.name)}" on ${input.issueId}`);

  const fresh = fetchFields(upstream, input.issueId, FULL_PROJECTION);
  if (!Array.isArray(fresh)) return fresh;
  return issueBody(
    { idReadable: input.issueId },
    fresh.filter((entry) => normalizeName(entryName(entry)) === normalizeName(field)),
  );
}

function upstreamFor(input: IssueContext): Upstream | Result {
  try {
    const baseUrl = deriveBaseUrl(input.issueUrl, input.settings.youtrackUrl);
    return { connect: input.connect, baseUrl, token: input.settings.serviceToken ?? '' };
  } catch (cause) {
    return error(500, 'configuration_error', (cause as Error).message);
  }
}

/** The issue's custom field entries as the technical user sees them, or the failure as a Result. */
function fetchFields(upstream: Upstream, issueId: string, fields: string): CustomFieldEntry[] | Result {
  const response = callYouTrack(upstream, {
    method: 'GET',
    path: issuePath(issueId, '/customFields'),
    query: { fields, $top: '-1' },
  });
  if (!response.ok) return { status: response.status, body: response.body };
  if (!Array.isArray(response.json))
    return failure(upstreamError('technical user request returned an unexpected body'));
  return response.json as CustomFieldEntry[];
}

/** YouTrack's issue shape: the given attributes, then `customFields`, then `$type`. */
function issueBody(attributes: IssueObject, customFields: CustomFieldEntry[]): Result {
  const { $type, ...rest } = attributes;
  return { status: 200, body: { ...rest, customFields, $type: typeof $type === 'string' ? $type : 'Issue' } };
}

/** The normalized requested names, or null when the caller asked for every field. */
function requestedNames(names: string[] | null | undefined): Set<string> | null {
  const normalized = (names ?? []).map(normalizeName).filter((name) => name.length > 0);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function readable(input: ReadInput, name: string): boolean {
  try {
    return input.canRead(name);
  } catch {
    return false;
  }
}

function allowed(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function entryName(entry: CustomFieldEntry): string {
  return typeof entry.name === 'string' ? entry.name : '';
}

function isObject(value: unknown): value is IssueObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(result: { status: number; body: ErrorBody }): Result {
  return { status: result.status, body: result.body };
}

function error(status: number, code: string, description: string): Result {
  return { status, body: { error: code, error_description: description } };
}
