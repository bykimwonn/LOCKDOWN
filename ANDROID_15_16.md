# Android 15 / Android 16 readiness

_Last updated: 2026-08-30_

BT LOCKDOWN's enforcement + sync layer is now **Android 15/16-correct at the
native level**. This file explains what was done, what still needs the Expo
SDK upgrade, and how to verify on real devices.

---

## 1. What changed in this repo

| File | Change | Why |
|---|---|---|
| `plugins/withBTLockdown.js` | Watchdog FGS type `dataSync` → `specialUse` + `FOREGROUND_SERVICE_SPECIAL_USE` permission + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property | Android 15+ (apps targeting API 35+): `dataSync` FGS **cannot** be launched from `BOOT_COMPLETED` (would break the reboot mid-session restart) and is capped at **6 h per 24 h**. `specialUse` has neither restriction. |
| `app.json` | Replaced `FOREGROUND_SERVICE_DATA_SYNC` with `FOREGROUND_SERVICE_SPECIAL_USE` | Type permission must match the declared FGS type. |
| `LockdownOverlayService.kt` | `startForeground(...)` now passes `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+ | Android 14+ requires the type to be passed in the `startForeground` call as well as declared. |
| `LockdownOverlayService.kt` | Added `onTimeout(startId, fgsType)` override | Android 15 calls it if a time-limited FGS is exhausted; we stop gracefully instead of the system throwing an internal exception. `specialUse` is not time-limited, so this is defense-in-depth (also covers OEM compat flags / a future switch back to `dataSync`). |
| `BootReceiver.kt` | Documented the `specialUse` requirement | Guards the reboot mid-session path on Android 15/16. |

These changes are safe on **every** Android version (7.0 → 16); they only
matter once the app targets API 35+.

## 2. What the app runs on right now (Expo SDK 52 / RN 0.76)

- ✅ **Regular Android 15 / Android 16 devices (4 KB pages):** installs and
  runs — Android is backwards-compatible.
- ❌ **16 KB-page devices** (Pixel 8/9 with "Boot with 16 KB page size", and
  new hardware shipping 16 KB): Expo SDK 52 / RN 0.76 is **not** 16 KB
  compliant. Google Play blocks such apps, and on real 16 KB hardware the
  native libs can fail to load. **This requires the SDK upgrade below.**
- ❌ **Google Play publishing:** from **2026-08-31**, new apps/updates must
  target **API 36** (Android 16). SDK 52 targets 34, so it cannot be
  published after that date.

## 3. Required: Expo SDK upgrade (52 → 54 recommended)

SDK 54 (React Native 0.81) is the release where **React Native for Android
targets Android 16 / API 36**, is 16 KB-compliant, and still supports the
Legacy Architecture. SDK 55 (RN 0.83) drops Legacy Architecture entirely —
only move there if you've already tested New Architecture.

Run on a machine **with internet** (this sandbox is offline):

```bash
# 1. Bump the SDK + compatible package versions
npx expo install expo@^54.0.0
npx expo install --fix
npx expo-doctor

# 2. Expect native-breaking package updates, especially:
#    react-native-reanimated   ~3.16  -> ~4.1   (requires New Architecture)
#    react-native-screens      ~4.4   -> ~4.16
#    react-native-safe-area-context 4.12 -> 5.x
#    expo-router               ~4.0   -> ~6.0
#    expo-notifications        ~0.29  -> ~0.32
#    expo-updates              ~0.27  -> ~1.0
# Do NOT hand-mix versions across SDKs — always use `npx expo install --fix`.

# 3. New Architecture must be ON for reanimated 4:
#    remove "newArchEnabled": false from app.json (SDK 54 default is true).

# 4. Regenerate native + verify
npx expo prebuild -p android --clean
npm run test:manifest    # android/app/src/main/AndroidManifest.xml check
npx expo run:android     # or: eas build -p android --profile preview
```

Notes:

- Our custom module (`modules/bt-lockdown-native`) is copied into the native
  project by `plugins/withBTLockdown.js`, so it is not autolinked and needs
  no module-version changes. Its classic `ReactContextBaseJavaModule` API
  compiles and runs under both architectures in SDK 54 (interop layer).
- **Edge-to-edge is always on in SDK 54.** All screens already use
  `useSafeAreaInsets()` and expo-router provides the `SafeAreaProvider`, so
  no layout changes are expected — verify visually on device.
- Target/compile SDK become 36 automatically; the `onTimeout` override is
  valid because compileSdk 36 ≥ 35.

## 4. Verification checklist (on Android 15 AND 16 devices)

```bash
# Force Android 15 FGS behavior even before the target bump:
adb shell am compat enable FGS_INTRODUCE_TIME_LIMITS com.btsoftware.lockdown
adb shell am compat enable FGS_BOOT_COMPLETED_RESTRICTIONS com.btsoftware.lockdown
# Shrink the dataSync timeout (only if you ever switch back to dataSync):
adb shell device_config put activity_manager data_sync_fgs_timeout_duration 120000
```

1. **Start a session → app to background → force-quit via recents.**
   - Persistent "BT LOCKDOWN" notification stays (foreground service).
   - Server still receives heartbeats (check `device_bindings.last_heartbeat`
     in the DB / server logs).
   - Blocked app launches still get intercepted after force-quit.
2. **Reboot mid-session.** After boot the watchdog must resume (notification
   returns, seal holds, sync heartbeats resume) — no
   `ForegroundServiceStartNotAllowedException` in logcat.
3. **Long session:** confirm no 6-hour stop for >6 h sessions (specialUse has
   no cap; a dataSync build would stop it).
4. **16 KB page size:** create an AVD from the **"16 KB Page Size"** Android
   15/16 system image (Other Images tab), or Pixel 8/9 → Developer options →
   boot with 16 KB pages; app must launch without native-load crashes.
5. **`npm run test:live-api`** on a networked machine — all 10 BT LEARNING
   routes must answer.
6. **Play Console (if publishing):** bundle must say
   "Memory page size: Supports 16 KB" and target API 36.

## 5. Known limits to keep in mind

- `specialUse` FGS is reviewed in Play Console when publishing to Play
  (declare the "student device lock" use case). Internal/EAS distribution is
  unaffected.
- Android 15 removed the old "holding `SYSTEM_ALERT_WINDOW` ⇒ may start FGS
  from background" exemption. On target 35+ the watchdog is started from the
  foreground (JS arm), from `BOOT_COMPLETED` (broadcast exemption), or from
  the enabled accessibility service — all valid paths. Keep accessibility ON
  and battery/autostart exemptions granted (see SETUP_GUIDE.md).
