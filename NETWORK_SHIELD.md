# Network shield + seal health (layer 3)

_Added 2026-09-04. Answers the one failure the seal could not cover: **the
accessibility service disappears mid-session and the student is back on social
media.**_

---

## 1. What changed, in one picture

```
                        BT LOCKDOWN CORE
                    (LockdownOverlayService
                     watchdog + server clock)
                             │
        ┌────────────────────┼────────────────────┐
        ↓                    ↓                    ↓
  AccessibilityHealth   LockdownVpnService   LockTaskController
  (launch intercept,    (blackhole tunnel,   (kiosk + uninstall
   hard seal)            kernel-enforced)     block, DO policy)
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ↓
                  NetworkProtectionManager
                     (health controller)
                             ↓
       PROTECTION STATE → notification · settings card · lockdown screen
       FULL / SEAL_ONLY / NETWORK_ONLY / DEGRADED
```

The middle layer is the new one, and it is deliberately **independent of
accessibility**: the block is a routing decision made by `netd`/the kernel, not
a check inside our code. If the seal service dies, the tunnel stays; if our whole
process dies on a school-managed device, Android keeps the tunnel up.

| Trigger | Before | Now |
| --- | --- | --- |
| Student toggles Accessibility off mid-session | tamper reported, hard seal raised after up to 60 s, **internet still live** | detected by a `Settings.Secure` observer (sub-second) **and** in `onUnbind`, hard seal raised immediately, shielded apps lose internet at the same instant, violation `network_shield_off`-class reporting unchanged |
| MIUI/Redmi kills the process | service restart only on next app open / boot | `onServiceConnected` re-arms the watchdog + shield; `stopWithTask=false`; `START_STICKY`; 15-min `setAndAllowWhileIdle` keep-alive tick |
| Phone rebooted mid-session | watchdog resumed, no network policy | watchdog resumes **and** re-applies always-on VPN + lockdown when device owner |
| Force-stop from Settings | enforcement gone until reopen | on a device-owner device the OS keeps the tunnel up and keeps blocking; on a personal phone it is a real escape (documented, §7) |
| Notification said "BT LOCKDOWN is running" | true but vague | says **what is actually enforcing**: `Full Protection`, `Sealed · internet open`, `Seal service off · internet blocked`, `PROTECTION DOWN` |

---

## 2. Files

| File | Job |
| --- | --- |
| `LockdownVpnService.kt` | `VpnService` blackhole tunnel. `0.0.0.0/0` + `::/0` into a descriptor nobody reads; no resolvers, so DNS dies with it. Own package excluded so BT LEARNING sync keeps working. |
| `NetworkProtectionManager.kt` | Modes (`off/apps/strict`), consent gate, the verify→repair→report loop, backoff, the 8 h ceiling, breaks, and every Device Owner call (`setAlwaysOnVpnPackage`, `DISALLOW_CONFIG_VPN`). |
| `AccessibilityHealth.kt` | Seal-layer watchdog: `Settings.Secure` observer, bound-vs-listed cross-check, kill-cause classification, DO accessibility allowlist. |
| `WatchdogAlarmReceiver.kt` | 15-min inexact/idle-allowed keep-alive (no exact-alarm permission needed). |
| `LockdownAccessibilityService.kt` | `onServiceConnected` revives the stack; `onUnbind`/`onDestroy` raise the hard seal **and** engage the shield. |
| `LockdownOverlayService.kt` | Calls `enforceLayers()` each tick, edge-triggered a11y loss, releases the shield on `expired`/`serverInactive`/disarm, notification reports verified protection. |
| `BTLockdownModule.kt` | `getProtectionStatus`, `setNetworkShield`, `requestNetworkShieldConsent`, `grantNetworkBreak`, `releaseNetworkShield`, `setAccessibilityAllowlist`, `openSealSettings`. |
| `plugins/withBTLockdown.js` | Declares the `VpnService` (`BIND_VPN_SERVICE` + `android.net.VpnService` action + `SUPPORTS_ALWAYS_ON`), the tick receiver, `stopWithTask=false`. |
| `src/services/protection.ts` | Pure renderer for the verified state (unit-tested). JS never recomputes the level — it renders what native proved. |

**Manifest shape — do not "tighten" it.** `LockdownVpnService` is declared with
`android:exported="true"` **and** `android:permission="android.permission.BIND_VPN_SERVICE"`
(the same shape as `LockdownAccessibilityService`). The `true` is not sloppiness: the tunnel is
bound cross-process by system_server, and both `VpnService.prepare()` and Settings → VPN find the
service with an *implicit* `android.net.VpnService` intent — implicit resolution skips non-exported
components. With `exported="false"` the shield would look armed, `establish()` would never be
reached, and nothing would be blocked. `android:permission` is the access control (only the
platform holds `BIND_VPN_SERVICE`). `scripts/check-android-manifest.mjs` and
`__tests__/withBTLockdown.test.js` both fail if it regresses. After any plugin change:

```bash
npx expo prebuild -p android --no-install --clean && npm run test:manifest
```

---

## 3. "ACTIVE" means *verified*, not "started"

`NetworkProtectionManager.verify()` only reports `STATE_ACTIVE` when all of these
hold on the same pass; anything weaker is `DEGRADED`/`FAILED` and the notification
says so:

```
policy wants a block?   mode != off · consent · prefs.active · no break · under ceiling
tunnel established?     LockdownVpnService.connected (establish() returned an fd)
framework routing?      ConnectivityManager reports a TRANSPORT_VPN network
control channel alive?  our default network has NET_CAPABILITY_NOT_VPN  (we are excluded)
school can still see?   a server round-trip was accepted in the last 150 s
```

`getProtectionStatus()` returns all of it (`tunnelUp`, `vpnNetworkSeen`,
`selfExcluded`, `controlChannelOk`, `failStreak`, `revokeCount`, `seal.*`), so the
teacher-side and the app both see the difference between "on" and "working".

Two things are **not** claimed, because an app cannot know them: per-UID netd
rules can't be read from userspace, so "this specific app is blocked" is proven
by the routing state above plus the fact that the tunnel never reads a packet;
and Android deliberately runs its own captive-portal/connectivity checks outside
any VPN, so the *system* still probes the network while apps do not. Say
"no usable Internet for apps", not "zero packets ever leave the device".

---

## 4. Modes

| Mode | Captured | Left online | Use |
| --- | --- | --- | --- |
| `off` (default) | nothing | everything | normal self-control |
| `apps` | only packages on the teacher's shield list | school apps, allowed browsers/whitelisted study apps | the everyday answer to "accessibility died but social media must not work" |
| `strict` | every app except BT LOCKDOWN | only BT LEARNING sync, phone/SMS (they have no data path anyway) | exams / Deep Work where even a browser must not load |

Notes that matter operationally:

* The shield list is read at `establish()` time, so editing it cannot reconfigure a
  live tunnel. Instead the watchdog compares a signature of what the tunnel was built
  with against the current list (`NetworkProtectionManager.captureSignature`) and
  rebuilds it — so a teacher adding an app takes effect within one tick, and
  `apps` mode never quietly keeps blocking yesterday's list.
* Browsers are still allowed an educational tab by the accessibility layer; in
  `strict` that tab will not load. If the class uses YouTube/Khan tabs, use
  `apps`.
* Consent: `setNetworkShield(mode, consent)` refuses to arm unless `consent` is
  true **or** the app is device owner (the institution is the authority there).
  Android additionally shows its own VPN dialog and a persistent VPN key, and
  `setSession("BT LOCKDOWN — Deep Work")` labels it. Nothing about this layer is
  hidden from the student or from `adb`.

---

## 5. Restart protection — what is covered, and what is not

| Failure | Covered by | Residual risk |
| --- | --- | --- |
| Process killed by OEM (MIUI cleaner, low RAM) | `START_STICKY` + `stopWithTask=false` + battery exemption + autostart prompt + 15-min idle-allowed alarm + accessibility rebind hook (`onServiceConnected`) | a device-owner device is unaffected (OS owns the tunnel); a personal phone has a gap of up to one tick |
| Reboot mid-session | `BootReceiver` → `startIdle` → watchdog re-applies shield + always-on policy | none when device owner |
| Force-stop / uninstall | `setUninstallBlocked` + lock-task pinning + `setAlwaysOnVpnPackage(..., lockdown = true, ...)` | **personal phone: still an escape.** Android intends that; the fix is provisioning the device, not fighting the OS |
| Student disconnects the VPN in Settings | from Android 11 an admin-configured always-on VPN cannot be turned off by the user; `DISALLOW_CONFIG_VPN` (opt-in) removes the panel entirely | non-managed device: honoured, reported, penalised as tamper — **not** yanked back |
| Another VPN app takes the tunnel | we detect `TRANSPORT_VPN` owned by someone else and refuse to fight (two VPNs just disconnect each other), state `DEGRADED` + event | documented behaviour; a malicious student can kill their own internet this way, which does not unblock anything |
| Student enables an automation app to tap the Accessibility toggle | `setPermittedAccessibilityServices([ourPackage])` (device owner, explicit) | a deliberate toggle by the user of the device is theirs to make — see §6 |

---

## 6. What was deliberately **not** built

The request was "trick Android so it cannot turn our accessibility service off,
and auto-restart it". That part is off the table, for two independent reasons:

1. **It is not possible from an app.** An `AccessibilityService` is bound by
   `system_server`; only that process (or the user, or a privileged caller
   holding `WRITE_SECURE_SETTINGS`) can bind/unbind it. There is no API to
   re-enable it, and a `settings put secure …` hack needs a shell/adb grant that
   is exactly the "root/adb-only" thing an installed app may not have. Anything
   that *did* work would be an exploit, not a feature.
2. **It is against the rules that keep this app installable.** Google's
   permissions policy for the Accessibility API forbids using it to
   "prevent the ability for users to disable or uninstall any app or service"
   or to "work around Android built-in platform security controls, privacy
   controls and notifications" — with the exception for what
   "authorized administrators through enterprise management software" do. And
   `VpnService`'s own contract gives the user a disconnect path.

So the *outcome* the student-facing behaviour needs is delivered the supported
way instead: the escape window is closed (sub-second detection → hard seal →
network block at the same instant), the blocking layer no longer depends on
accessibility at all, and on devices the school owns the *OS* enforces the
policy — where "cannot be turned off by the user" is legitimately true. If a
deployment needs the extra accessibility restriction, it is a one-call Device
Owner setting that the school applies, visible in Settings, and reversible.

---

## 7. Enabling the strong form (school-managed devices)

```bash
# once per device, with the device freshly set up (no accounts on it)
adb shell dpm set-device-owner com.btsoftware.lockdown/.LockdownAdminReceiver

# verify
adb shell dumpsys device_policy | head -40          # "Device Owner: pkg=…"
adb shell settings get secure enabled_accessibility_services
adb shell dumpsys connectivity | grep -i vpn         # TRANSPORT_VPN while sealed
adb shell dumpsys activity services com.btsoftware.lockdown
adb shell dumpsys alarm | grep com.btsoftware.lockdown   # the 15-min keep-alive
```

With device owner, arming the shield also calls
`setAlwaysOnVpnPackage(admin, ourPackage, /* lockdown */ true, /* allowlist */ { ourPackage})`:

* the tunnel is started and kept up by Android, and survives reboot;
* **while the tunnel is down, non-exempted apps get no network at all** — that is
  the property that makes a force-stop of our process pointless;
* our own package is in the lockdown allowlist, so BT LOCKDOWN can still reach
  BT LEARNING (and still receive "the teacher ended the session");
* API 24–28 have no allowlist overload, so there the code sets always-on
  *without* lockdown rather than risk locking the app out of its own server;
* every policy is cleared on release (`setAlwaysOnVpnPackage(admin, null, false)`
  only clears a configuration this admin created, so a user-set VPN is untouched).

On a personal phone: the shield still works while our process lives, and the app
says plainly in the enforcement card what the difference is.

---

## 8. Safety valves (a phone must never be stranded offline)

1. Default `off`; arming needs consent or device ownership.
2. The block tracks `prefs.active` exactly: `expired`, `serverInactive`,
   `unauthorized`, `deactivate()`, sign-out and `stopEverything()` all call
   `NetworkProtectionManager.release()`.
3. `MAX_BLOCK_MS` = 8 h hard ceiling, checked in `shouldBlockNow()` — even with a
   corrupted "armed" flag the block lifts itself.
4. `LockdownVpnService.onStartCommand` re-checks `shouldBlockNow()` and
   self-stops when it is false, so a boot into a stale state cannot block.
5. `release()` also closes the descriptor directly (`forceClose()`), because a
   `startService` stop command can be refused by background limits — the release
   path must never be the thing that fails.
6. `grantNetworkBreak(minutes)` — capped (≤15 min, ≤2 per session) internet-only
   break; the seal stays up, and the break is anchored to the server clock so a
   rewound device clock cannot stretch it.
7. `releaseNetworkShield()` is refused by native code while a session is sealed:
   the exits are the timetable, the teacher, or the school's own DPC.

---

## 9. Server contract — unchanged

No new routes. New client-side violation type `network_shield_off` maps to the
existing `POST /api/lockdown/event` `event_type: "tamper_detected"` (same class as
`accessibility_off` / `admin_disabled` → −50 ELO + streak broken, mirrored in
`src/services/penalties.ts`). Technical shield problems (`netProtectDown`,
`netProtectDegraded`) are **never** reported as tamper — they refresh the UI only,
because a ROM refusing our tunnel is not the student's fault.

---

## 10. Device test checklist

1. **Seal + shield both on** → notification "BT LOCKDOWN — Full Protection";
   a shielded app's login screen spins/fails; BT LOCKDOWN still syncs (watch the
   `last_heartbeat` row in `device_bindings`).
2. **Toggle Accessibility off during a session** → within ~1 s: barrier up,
   violation recorded, notification flips to "Seal service off · internet
   blocked", shielded app still has no internet. Re-enable from the notification
   action → "Full Protection" again.
3. **Force-quit the app from recents** → shield holds (per-app: `apps` mode);
   `dumpsys activity services` still lists the watchdog.
4. **Reboot mid-session** → after unlock, barrier resumes and the block returns;
   no `ForegroundServiceStartNotAllowedException` in logcat.
5. **`adb shell force-stop com.btsoftware.lockdown`** → on a device-owner device
   the block stays (always-on + lockdown); on a personal phone it lifts, which is
   the honest reason to provision exam devices.
6. **Break** → tap "Grant 5-min internet break" → internet returns for the
   window, seal holds, block returns on the next tick.
7. **End the session in BT LEARNING** → within one 5 s tick the tunnel closes and
   the DPC policy is cleared (`dumpsys device_policy` no longer lists it).

---

## 11. Known limits / follow-ups

* **iOS**: nothing here applies; enforcement stays "unavailable" in-app (Family
  Controls / a Network Filter payload would be its own project).
* **Android 15/16**: the shield uses no new foreground-service type (the tunnel is
  system-bound), so it is unaffected by the `dataSync` cap; the 16 KB-page and
  API 36 requirements in `ANDROID_15_16.md` still gate Play publishing.
* **`specialUse` FGS + `BIND_VPN_SERVICE` + device admin** all need to be declared
  in the Play Console for the relevant policies if this is published there;
  internal/EAS distribution is unaffected.
* A blocked app can still be used *offline* (cached feeds, local games). Closing
  that needs lock-task/kiosk (already wired) or hiding the apps
  (`setApplicationHidden` — device owner, next sprint).
* `setNetworkLoggingEnabled(admin, true)` would give the school a per-app log of
  which apps *tried* to reach the network during a session (device owner, API 21+,
  logs must be polled with `retrieveNetworkLogs` and are capped/cleared by the
  OS). Deliberately not enabled here: it needs its own retention story.

---

## 12. How the app tells you something is off (added with the seal-health layer)

Two rules, because the phone drops the seal on its own and the app used to react
badly to that:

| Situation | What the student sees |
| --- | --- |
| First run, grants missing | The one-time "Arm the operating system" screen (`/permissions`), in the only order Android accepts the grants |
| Later, seal switched off / killed | Red **"Seal service is off"** strip at the top of Home + a heads-up **system notification** ("Re-enable now" / "Later") — never a screen the app drags you to |
| During a sealed session | The barrier stays, the notification reads *seal service OFF*, and the strip on Home cannot be snoozed away |
| Seal comes back | Banner and notification disappear by themselves |

Mechanics worth knowing before editing:

* Policy lives in `src/services/attention.ts` (`computeAttention`) — a pure function,
  unit-tested in `__tests__/attention.test.ts`. Call sites are pinned by
  `__tests__/attentionGuards.test.js`, including "no route hijack from `arm()`".
* The notification is raised natively (`LockdownOverlayService.syncSealAlert`) so it
  works with JS dead: own channel `bt_lockdown_alert` (the ongoing one stays
  `IMPORTANCE_LOW`), re-raised at most every 30 min while the problem persists,
  cancelled on restore and by the banner's "Later"/"Re-enable now".
* It stays **silent until the seal has been enabled once** on the device
  (`a11yBoundAt`) or a session is running, so a student mid-setup is not nagged by
  both the setup screen and a notification.
* `getDeviceGuard()` has a 2 s JS cache; a code path that just changed a permission
  must bypass it (`getDeviceGuard(true)` / `invalidateDeviceGuard()`).
