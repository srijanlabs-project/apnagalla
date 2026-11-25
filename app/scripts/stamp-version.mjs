#!/usr/bin/env node
/**
 * Stamps a new build number into app/version.json before each app build:
 *   build = YYYYMMDDNN (NN counts builds made that day), so every APK is newer than the last.
 * `release` (e.g. "R4") is set by hand when a release starts. Gradle reads this file for the
 * Android versionCode / versionName, and the app shows it under More.
 *
 *   node scripts/stamp-version.mjs          next build number
 *   node scripts/stamp-version.mjs --keep   only refresh the commit (same build number)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'version.json');
const cur = JSON.parse(readFileSync(file, 'utf8'));
const now = new Date();
const day = Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
let build = cur.build;
if (!process.argv.includes('--keep')) build = Math.floor(cur.build / 100) === day ? cur.build + 1 : day * 100 + 1;
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};
const commit = git('rev-parse --short HEAD');
// Uncommitted changes other than this file: the build isn't exactly that commit.
const dirty = git('status --porcelain').split('\n').filter((l) => l && !l.endsWith('version.json')).length > 0;
const next = { release: cur.release, build, commit: commit + (dirty ? '+' : ''), builtAt: now.toISOString() };
writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
console.log(`ApnaGalla ${next.release} build ${next.build} (${next.commit})`);
