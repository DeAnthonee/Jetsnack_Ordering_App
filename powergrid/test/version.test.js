import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, CHANGELOG } from '../server/version.js';

test('the version, changelog and package.json agree', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(CHANGELOG[0].version, VERSION, 'newest changelog entry must match VERSION');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, VERSION, 'package.json version must match VERSION');
  const versions = CHANGELOG.map((e) => e.version);
  assert.equal(new Set(versions).size, versions.length, 'no duplicate versions');
  for (const e of CHANGELOG) assert.ok(e.changes.length && e.date, `entry ${e.version} needs changes and a date`);
});
