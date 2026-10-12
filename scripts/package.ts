// Packs dist/ into out/hidden-fields-<version>.zip. Fixed timestamps and sorted entries keep the zip reproducible.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { checkPackage, type ZipEntry } from './package-lib.ts';

const FIXED_MTIME = new Date('2000-01-01T00:00:00Z');

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8')) as { name: string; version: string };
const backendNames = readdirSync('src/backend')
  .filter((file) => file.endsWith('.ts'))
  .map((file) => file.slice(0, -'.ts'.length))
  .sort();
const paths = (readdirSync('dist', { recursive: true }) as string[])
  .filter((path) => statSync(`dist/${path}`).isFile())
  .sort();
const entries: ZipEntry[] = paths.map((name) => ({ name, content: readFileSync(`dist/${name}`) }));

const problems = checkPackage(entries, backendNames);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const zip = zipSync(Object.fromEntries(entries.map((entry) => [entry.name, [entry.content, { mtime: FIXED_MTIME }]])), {
  level: 9,
});
mkdirSync('out', { recursive: true });
const target = `out/${manifest.name}-${manifest.version}.zip`;
writeFileSync(target, zip);
console.log(target);
