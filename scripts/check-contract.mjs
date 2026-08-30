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

// --------------------------------------------------------------------------
// Full phone -> server route surface. Every /api/lockdown/* path the phone
// (JS client OR native watchdog) calls must appear here. If code starts
// calling a new endpoint, CI fails until it is added to this allowlist AND
// exists on the deployed BT LEARNING side — otherwise the two sides silently
// drift apart and a session can be "lost" between them.
//
// Half of these live in teaching_mobile.py (the hand-off file in this repo);
// the other half (current/heartbeat/event/complete/create) are provided by
// app.py in the BT LEARNING website repo and are documented in
// DO_NOT_OVERWRITE.md. `scripts/check-live-api.mjs` verifies them against a
// running server.
// --------------------------------------------------------------------------
const PINNED_PHONE_ROUTES = new Set([
  '/api/lockdown/login',
  '/api/lockdown/me',
  '/api/lockdown/schedule',
  '/api/lockdown/sync',
  '/api/lockdown/logout',
  '/api/lockdown/current', // native watchdog poll (foreground service)
  '/api/lockdown/heartbeat', // native watchdog, every 20s
  '/api/lockdown/event', // violation reporting (JS outbox + native queue)
  '/api/lockdown/complete', // session completion
  '/api/lockdown/create', // manual Deep Work session
]);

const phoneSources = [
  'src/services/api.ts',
  'src/store/AppState.tsx',
  'modules/bt-lockdown-native/android/src/main/java/com/btsoftware/lockdown/LockdownOverlayService.kt',
  'modules/bt-lockdown-native/android/src/main/java/com/btsoftware/lockdown/NativeReporter.kt',
];

const used = new Set();
for (const file of phoneSources) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`MISSING phone source: ${file}`);
    failed = true;
    continue;
  }
  for (const m of text.matchAll(/\/api\/lockdown\/[a-z-]+/g)) used.add(m[0]);
}

if (used.size === 0) {
  console.error('No /api/lockdown/* paths found in phone sources — scan is broken?');
  failed = true;
} else {
  for (const route of [...used].sort()) {
    if (!PINNED_PHONE_ROUTES.has(route)) {
      console.error(
        `Phone code calls ${route} but it is not in the pinned contract allowlist. ` +
          'Add it deliberately (and to the server) before merging.'
      );
      failed = true;
    }
  }
  console.log(
    `Phone route surface pinned (${used.size}/10 in allowlist): ${[...used].sort().join(', ')}`
  );
}

if (!failed) console.log('Contract route surface intact.');

process.exit(failed ? 1 : 0);
