// Bundles each src/backend/<name>.ts into a self-contained CommonJS dist/<name>.js and copies the static files.
// Rollup emits `exports.<name> = …` assignments, which is the module form YouTrack loads.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { build } from 'vite';
import { STATIC_FILES } from './package-lib.ts';

const backendFiles = readdirSync('src/backend', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => entry.name)
  .sort();

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

for (const file of backendFiles) {
  const name = file.slice(0, -'.ts'.length);
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      target: 'es2022',
      lib: { entry: `src/backend/${file}`, formats: ['cjs'], fileName: () => `${name}.js` },
      rollupOptions: {
        external: [/^@jetbrains\/youtrack-scripting-api\//],
        output: { exports: 'named', esModule: false },
      },
    },
  });
}

for (const file of STATIC_FILES) copyFileSync(`src/${file}`, `dist/${file}`);
console.log(`built ${backendFiles.length} backend module(s) into dist/`);
