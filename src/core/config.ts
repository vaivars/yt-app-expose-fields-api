/** Normalizes a field name for comparisons: trimmed and lowercase. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Splits a list of field names: the `exposedFields` setting or a `fields` request parameter. A single line is split on
 * commas, and a name in double quotes may contain commas (`A, "B, C"`), since the settings page offers a one-line
 * input. A value with several lines, as set over the API, is split on newlines only. Names are trimmed and kept as
 * written; blanks and later duplicates that differ only in case are dropped.
 */
export function listNames(raw: string | null | undefined): string[] {
  const value = raw?.trim() ?? '';
  const names = /[\r\n]/.test(value) ? value.split(/\r?\n/) : splitCommaList(value);
  const seen = new Set<string>();
  const listed: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      listed.push(name.trim());
    }
  }
  return listed;
}

/** The normalized names of a list, for matching: see `listNames`. */
export function parseNames(raw: string | null | undefined): Set<string> {
  return new Set(listNames(raw).map(normalizeName));
}

/** Splits on commas outside double quotes and drops the quotes. */
function splitCommaList(value: string): string[] {
  const names: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      names.push(current);
      current = '';
    } else current += char;
  }
  names.push(current);
  return names;
}

/** The base URL for calling YouTrack's REST API: the `youtrackUrl` override, or the issue URL without `/issue/<id>`. */
export function deriveBaseUrl(issueUrl: string, override?: string | null): string {
  const explicit = override?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const marker = issueUrl.lastIndexOf('/issue/');
  if (marker < 0) {
    throw new Error(`Cannot derive the YouTrack base URL from "${issueUrl}"; set the youtrackUrl setting`);
  }
  return issueUrl.slice(0, marker);
}
