#!/usr/bin/env node
/**
 * Runs each bundled suite in its own node process so a crash in one suite cannot
 * hide the others. Suites needing live Mapbox calls are skipped unless a token is
 * available, so the default run stays offline and free.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = 'node_modules/.test-build';
const LIVE_SUITES = new Set(['live']);

function readEnvToken() {
  if (process.env.MB_TOKEN) return process.env.MB_TOKEN;
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('VITE_MAPBOX_ACCESS_TOKEN='));
  const value = line?.slice('VITE_MAPBOX_ACCESS_TOKEN='.length).trim().replace(/^"|"$/g, '');
  return value || undefined;
}

const token = readEnvToken();
const suites = readdirSync(BUILD_DIR)
  .filter((file) => file.endsWith('.mjs'))
  .sort();

let failed = 0;
let skipped = 0;

for (const file of suites) {
  const name = file.replace(/\.mjs$/, '');

  if (LIVE_SUITES.has(name) && !token) {
    console.log(`${name}: SKIPPED (no Mapbox token; set MB_TOKEN or .env)`);
    skipped++;
    continue;
  }

  const result = spawnSync(process.execPath, [join(BUILD_DIR, file)], {
    stdio: 'inherit',
    env: { ...process.env, MB_TOKEN: token ?? '' },
  });
  if (result.status !== 0) failed++;
}

const ran = suites.length - skipped;
console.log(
  failed === 0
    ? `\nAll ${ran} suite(s) passed${skipped ? `, ${skipped} skipped` : ''}.`
    : `\n${failed} of ${ran} suite(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
