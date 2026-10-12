import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        // YouTrack provides these modules at runtime; unit tests use fakes.
        find: /^@jetbrains\/youtrack-scripting-api\/(.*)$/,
        replacement: fileURLToPath(new URL('./test/fakes/scripting-api/$1.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});
