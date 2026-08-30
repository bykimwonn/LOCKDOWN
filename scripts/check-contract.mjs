#!/usr/bin/env node
/**
 * Contract guardrail (Tier 4): teaching_mobile.py is the hand-off file for
 * the BT LEARNING website repo. The root copy and FOR_TEACHING/ are the
 * canonical sources; website/ was historically a stale convenience copy
 * that silently drifted (301 diff lines caught during review). This check
 * fails CI if the copies diverge, so the phone never ships against a
 * bridge whose route shapes changed in one place only.
 *
 * It also pins the route surface the phone's services/api.ts depends on.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const md5 = (p) => createHash('md5').update(readFileSync(p, 'utf8')).digest('hex');

const copies = ['teaching_mobile.py', 'FOR_TEACHING/teaching_mobile.py', 'website/teaching_mobile.py'];
let failed = false;

const hashes = new Map();
for (const c of copies) {
  try {
    hashes.set(c, md5(c));
  } catch {
    console.error(`MISSING contract file: ${c}`);
    failed = true;
  }
}

const unique = new Set(hashes.values());
if (unique.size > 1) {
  console.error('teaching_mobile.py copies have DIVERGED:');
  for (const [c, h] of hashes) console.error(`  ${h}  ${c}`);
  console.error('\nSync website/teaching_mobile.py from the canonical root copy before merging.');
  failed = true;
} else {
  console.log('teaching_mobile.py copies are in sync.');
}

// Pin the route surface used by src/services/api.ts.
const src = hashes.size ? readFileSync('teaching_mobile.py', 'utf8') : '';
const requiredRoutes = [
  '/api/lockdown/login',
  '/api/lockdown/me',
  '/api/lockdown/schedule',
  '/api/lockdown/sync',
  '/api/lockdown/logout',
];
for (const route of requiredRoutes) {
  if (!src.includes(route)) {
    console.error(`Contract file is missing route ${route} — the phone app depends on it.`);
    failed = true;
  }
}
if (!failed) console.log('Contract route surface intact.');

process.exit(failed ? 1 : 0);
