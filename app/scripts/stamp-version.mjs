#!/usr/bin/env node
/**
 * Stamps the next version into app/version.json before each app build.
 *
 *   name = MM.YY.DD.N  (month . year . date . sequence), e.g. 11.26.26.2
 *   N counts every build of the year and starts again at 1 on 1 January.
 *
 * Android also needs a plain number that only ever goes up (versionCode); the name can't be it
 * (01.27… would look smaller than 12.26…), so: code = 2030000000 + (year − 2026) × 100000 + N.
 * (It starts above 2026112601, the first numbered build, so that phone updates normally.)
 * `release` (e.g. "R4") is set by hand when a release starts.
 *
 *   node scripts/stamp-version.mjs          next build
 *   node scripts/stamp-version.mjs --keep   only refresh the commit (same build)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'version.json');
const cur = JSON.parse(readFileSync(file, 'utf8'));
const now = new Date();
const year = now.getFullYear();
const two = (n) => String(n).padStart(2, '0');
let seq = cur.seq ?? 0;
if (!process.argv.includes('--keep')) seq = cur.year === year ? seq + 1 : 1;
const name = `${two(now.getMonth() + 1)}.${two(year % 100)}.${two(now.getDate())}.${seq}`;
const code = 2030000000 + (year - 2026) * 100000 + seq;
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
const next = { release: cur.release, year, seq, name, code, commit: commit + (dirty ? '+' : ''), builtAt: now.toISOString() };
writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
console.log(`ApnaGalla ${next.release} ${next.name} (${next.commit})`);
