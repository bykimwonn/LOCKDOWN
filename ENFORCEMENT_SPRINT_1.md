# Enforcement sprint 1 — closing the seal holes

Tier-1 tamper holes plus the test/CI guardrails. All native items here are
inside **this** native build; JS items can later ship via EAS Update.

## Native (must be in the APK — requires the one EAS build)

| Hole | Fix | Files |
| --- | --- | --- |
| Reboot gap: watchdog died on restart | `BootReceiver` relaunches the service on BOOT_COMPLETED when a session is armed | `BootReceiver.kt`, plugin manifest |
| Clock rewind extended sessions | Watchdog + barrier countdown use a server-anchored clock (`clockOffsetMs`, refreshed every tick); intervals use `elapsedRealtime` so wall-clock changes can't slow them | `LockdownOverlayService.kt` |
| Violations died with the React process | `NativeReporter`: events go to JS when alive; when JS is dead they're queued in prefs and POSTed natively (survives reboot, FIFO flush each tick, `client_event_id` for dedupe) | `NativeReporter.kt` |
| Uninstall / admin removal | Device-admin tripwire (`LockdownAdminReceiver`): active admin blocks silent uninstall; removing it mid-session reports tamper. Watchdog also detects removal. **Watch-only admin — never locks/wipes.** | `LockdownAdminReceiver.kt`, `res/xml/lockdown_device_admin.xml`, plugin, `BTLockdownModule.kt` |
| Shield edits mid-session | `updateShield` is **rejected natively** while `active` (defense in depth) | `BTLockdownModule.kt` |
| Battery/server hammering | Watchdog backs off 5s → 10/20/30s on repeated failures | `LockdownOverlayService.kt` |

## JS (works via OTA, but shipped in this build too)

| Hole | Fix | Files |
| --- | --- | --- |
| Shield tab editable while sealed | Toggles disabled + "Shield locked during Deep Work" banner; `toggleApp` no-ops while sealed | `app/(app)/shield.tsx`, `AppState.tsx` |
| Device admin not requested | Prompted alongside accessibility/overlay during permission setup (best effort) | `AppState.tsx`, `lockdownNative.ts` |
| Admin removal event | `adminDisabled` native event → `admin_disabled` violation (-50, streak) | `AppState.tsx`, types, `api.ts` |
| Sync loop hammered a cold server | 4s → backoff 8/15/30s + jitter on failure | `AppState.tsx` |
| Modal said "-40 ELO", code applied -25 | Copy corrected to 25 | `app/lockdown.tsx` |
| Penalty table in 3 places | Single pure module `src/services/penalties.ts` (unit tested) | `penalties.ts` |

## Tests + CI (Tier 4)

- Jest + jest-expo, 17 tests: server time / `toIso` parsing (the phantom
  clock-tamper bug class), penalty table, outbox FIFO/drain behavior.
- `npm test` / `npx jest`; `scripts/check-contract.mjs` fails if the three
  `teaching_mobile.py` copies drift or lose a route the phone uses.
- `.github/workflows/ci.yml`: typecheck + tests + contract check on every
  PR and push to main.
- `website/teaching_mobile.py` was re-synced to the canonical root copy
  (it had drifted 301 lines).

## Not done in this sprint (deliberately)

- PackageManager app enumeration / default-block-unknown (Tier 1 #4) —
  larger native surface, next sprint.
- DND auto-enable, notifications expansion, stats/leaderboard UI — Tier 2/3.
- iOS Family Controls wiring — reported as unavailable in-app.
