#!/usr/bin/env node
/**
 * Live API verification (run from a machine WITH internet — the EAS/sandbox
 * build machines are offline).
 *
 * Verifies every /api/lockdown/* endpoint the phone depends on actually
 * exists on the deployed BT LEARNING server, so the phone and server never
 * "lose each other" because of a missing/renamed route.
 *
 * Usage:
 *   node scripts/check-live-api.mjs                      # uses https://api.btlearningsolutions.com
 *   API_BASE=https://staging... node scripts/check-live-api.mjs
 *
 * Interpretation ("route exists" proof, no credentials needed):
 *   - GET routes with Bearer auth    -> 401 unauthorized  = route exists, auth gate works
 *   - POST routes                    -> 405 method not allowed on GET = route exists
 *   - login POST with empty body     -> 400 id_and_password_required = route exists
 *   - 404 / DNS failure              -> route MISSING on the live server
 */
const BASE = (process.env.API_BASE || 'https://api.btlearningsolutions.com').replace(/\/+$/, '');

/** [path, method, body] — body only for POST probes that must not create data. */
const PROBES = [
  ['/api/lockdown/login', 'POST', undefined], // expect 400 (no creds) — proves route
  ['/api/lockdown/me', 'GET', undefined],
  ['/api/lockdown/schedule', 'GET', undefined],
  ['/api/lockdown/sync', 'GET', undefined],
  ['/api/lockdown/logout', 'POST', '{}'],
  ['/api/lockdown/current', 'GET', undefined],
  ['/api/lockdown/heartbeat', 'POST', '{}'],
  ['/api/lockdown/event', 'POST', '{}'],
  ['/api/lockdown/complete', 'POST', '{}'],
  ['/api/lockdown/create', 'POST', '{}'],
];

// Statuses that prove the route EXISTS as far as the phone is concerned.
const EXISTS = new Set([400, 401, 403, 405, 422, 429]);

let failed = false;
const rows = [];

for (const [path, method, body] of PROBES) {
  const started = Date.now();
  let status = 0;
  let note = '';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    if (EXISTS.has(status)) {
      note = 'route exists';
    } else if (status === 404) {
      note = 'ROUTE MISSING';
      failed = true;
    } else {
      note = 'unexpected status';
    }
  } catch (e) {
    note = `NETWORK FAILURE — ${e?.cause?.code || e?.message || 'unknown'} (no internet here?)`;
    failed = true;
  }
  rows.push({ path, method, status, ms: Date.now() - started, note });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nLive API check against ${BASE}\n`);
for (const r of rows) {
  const mark = r.status === 404 || r.note.startsWith('NETWORK') ? '✗' : r.note === 'route exists' ? '✓' : '?';
  console.log(
    `  ${mark} ${pad(r.method, 5)} ${pad(r.path, 32)} HTTP ${pad(r.status, 3)} ${pad(r.ms + 'ms', 8)} ${r.note}`
  );
}

if (failed) {
  console.error(
    '\n✗ The deployed server is NOT serving the full phone contract.' +
      '\n  Exactly one of the phone / server sides is stale — sessions can diverge.' +
      '\n  Fix the server (BT LEARNING website repo, app.py) or pin the matching contract in DO_NOT_OVERWRITE.md.'
  );
  process.exit(1);
}
console.log('\n✓ All phone-required endpoints are live on the server.\n');
