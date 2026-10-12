// Packs dist/ into out/hidden-fields-<version>.zip; buildZip keeps the bytes reproducible.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { buildZip, checkPackage, type ZipEntry } from './package-lib.ts';

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

mkdirSync('out', { recursive: true });
const target = `out/${manifest.name}-${manifest.version}.zip`;
writeFileSync(target, buildZip(entries));
console.log(target);
