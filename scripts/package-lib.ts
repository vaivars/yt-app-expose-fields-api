import { zipSync } from 'fflate';

/** A file inside the app zip. `name` is its path inside the zip. */
export interface ZipEntry {
  name: string;
  content: Uint8Array;
}

/** Files every build must ship at the zip root, next to one `<name>.js` per `src/backend/<name>.ts`. */
export const STATIC_FILES = ['manifest.json', 'settings.json', 'icon.svg'];

const MODULE_EXPORTS = ['exports.httpHandler', 'exports.aiTool'];

/** Returns the problems that would stop YouTrack from loading the zip; an empty list means it is fine. */
export function checkPackage(entries: ZipEntry[], backendNames: string[]): string[] {
  const problems: string[] = [];
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of [...STATIC_FILES, ...backendNames.map((name) => `${name}.js`)]) {
    if (!names.has(required)) problems.push(`missing ${required} at the zip root`);
  }
  for (const entry of entries) {
    if (entry.name.includes('/')) {
      problems.push(`${entry.name} is not at the zip root`);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = new TextDecoder().decode(entry.content);
    const found = MODULE_EXPORTS.filter((marker) => source.includes(marker)).length;
    if (found !== 1) problems.push(`${entry.name} must export exactly one of httpHandler or aiTool (found ${found})`);
  }
  return problems;
}

/**
 * Zips the entries with sorted names and a fixed timestamp, so the same files give the same bytes on any machine.
 * Zip timestamps hold local calendar fields, so the date is built from local fields at call time: it reads
 * 2000-01-01 00:00 in every time zone.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return zipSync(Object.fromEntries(sorted.map((entry) => [entry.name, [entry.content, { mtime }]])), { level: 9 });
}
