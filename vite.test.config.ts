import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';

// Every tests/*.test.ts becomes its own node-executable bundle.
const entries = Object.fromEntries(
  readdirSync('tests')
    .filter((file) => file.endsWith('.test.ts'))
    .map((file) => [file.replace(/\.test\.ts$/, ''), `tests/${file}`]),
);

export default defineConfig({
  // Mirrors the app config's define. Settings renders the build stamp, so a suite that
  // renders that panel fails on a bare ReferenceError without it.
  define: { __APP_BUILD__: JSON.stringify('test') },
  // Deliberately point at a directory with no .env files: token-resolution tests
  // must not depend on whichever token the developer happens to have locally.
  // The live suite receives its token through process.env.MB_TOKEN instead.
  envDir: 'tests',
  build: {
    ssr: true,
    outDir: 'node_modules/.test-build',
    emptyOutDir: true,
    rollupOptions: {
      input: entries,
      output: { entryFileNames: '[name].mjs' },
    },
  },
});
