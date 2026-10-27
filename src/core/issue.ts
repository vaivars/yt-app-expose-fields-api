import { canUseExposedFields } from './access';
import { deriveBaseUrl, normalizeName, parseNames } from './config';
import { COMPACT_ISSUE_PROJECTION, COMPACT_PROJECTION, FULL_PROJECTION, ISSUE_PROJECTION } from './projection';
import type { CustomFieldEntry, ErrorBody, IssueContext, IssueObject, ReadInput, Result, UpdateInput } from './types';
import { callYouTrack, issuePath, type Upstream, upstreamError } from './upstream';

/**
 * get_issue: the ticket in YouTrack's REST shape with every custom field the caller can read plus the exposed ones,
 * or, when names are requested, only those fields. Compact unless `full` is set. Requested names it doesn't return are
 * listed in `missing`, without saying why, so a hidden field looks the same as one that doesn't exist.
 */
export function getIssue(input: ReadInput): Result {
  const upstream = upstreamFor(input);
  if ('status' in upstream) return upstream;

  const exposedAllowed = canUseExposedFields(input.settings.allowedGroup, input.user);
  const exposed = exposedAllowed ? parseNames(input.settings.exposedFields) : new Set<string>();
  const only = requestedNames(input.names);
  const wanted = (name: string): boolean =>
    (only === null || only.has(normalizeName(name))) && (exposed.has(normalizeName(name)) || readable(input, name));

  const projection = input.full ? FULL_PROJECTION : COMPACT_PROJECTION;
  let attributes: IssueObject = { idReadable: input.issueId };
  let fields: CustomFieldEntry[];
  if (only === null) {
    const issue = fetchIssue(
      upstream,
      input.issueId,
      input.full ? ISSUE_PROJECTION : COMPACT_ISSUE_PROJECTION,
      projection,
    );
    if ('status' in issue) return issue;
    ({ attributes, customFields: fields } = issue);
  } else {
    const named = fetchFields(upstream, input.issueId, projection);
    if (!Array.isArray(named)) return named;
    fields = named;
  }

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

  if (only === null) return issueBody(attributes, kept);
  const found = new Set(kept.map((entry) => normalizeName(entryName(entry))));
  const missing = [...only].filter(([key]) => !found.has(key)).map(([, name]) => name);
  return issueBody(attributes, kept, missing);
}

/** update_issue: sets one exposed field as the technical user; returns a short status, or its fresh entry when `full` is set. */
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
    query: { fields: input.full ? withCustomFields('idReadable', FULL_PROJECTION) : 'idReadable' },
    payload: { customFields: [{ name: target.name, $type: target.$type, value: input.value }] },
  });
  if (!written.ok) return { status: written.status, body: written.body };
  input.log.info(`update_issue: ${input.actor} set "${String(target.name)}" on ${input.issueId}`);
  if (!input.full) return { status: 200, body: { idReadable: input.issueId, field: target.name, status: 'updated' } };

  const fresh = splitCustomFields(written.json);
  if ('status' in fresh) return fresh;
  return issueBody(
    { idReadable: input.issueId },
    fresh.customFields.filter((entry) => normalizeName(entryName(entry)) === normalizeName(field)),
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

/** The issue's attributes and custom field entries as the technical user sees them, in one call; or the failure. */
function fetchIssue(upstream: Upstream, issueId: string, attributes: string, fields: string): IssueWithFields | Result {
  const response = callYouTrack(upstream, {
    method: 'GET',
    path: issuePath(issueId),
    query: { fields: withCustomFields(attributes, fields) },
  });
  if (!response.ok) return { status: response.status, body: response.body };
  return splitCustomFields(response.json);
}

/** An issue projection that includes its custom fields. YouTrack doesn't page nested lists, so all of them come back. */
function withCustomFields(attributes: string, fields: string): string {
  return `${attributes},customFields(${fields})`;
}

interface IssueWithFields {
  attributes: IssueObject;
  customFields: CustomFieldEntry[];
}

/** Separates the custom fields from the other attributes of an issue YouTrack returned. */
function splitCustomFields(json: unknown): IssueWithFields | Result {
  if (!isObject(json) || !Array.isArray(json.customFields)) {
    return failure(upstreamError('technical user request returned an unexpected body'));
  }
  const { customFields, ...attributes } = json;
  return { attributes, customFields };
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

/** YouTrack's issue shape: the given attributes, then `customFields`, then `missing` if any, then `$type`. */
function issueBody(attributes: IssueObject, customFields: CustomFieldEntry[], missing: string[] = []): Result {
  const { $type, ...rest } = attributes;
  return {
    status: 200,
    body: {
      ...rest,
      customFields,
      ...(missing.length > 0 ? { missing } : {}),
      $type: typeof $type === 'string' ? $type : 'Issue',
    },
  };
}

/** The requested names by normalized name, as given (trimmed), or null when the caller asked for every field. */
function requestedNames(names: string[] | null | undefined): Map<string, string> | null {
  const requested = new Map<string, string>();
  for (const name of names ?? []) {
    const key = normalizeName(name);
    if (key && !requested.has(key)) requested.set(key, name.trim());
  }
  return requested.size > 0 ? requested : null;
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
