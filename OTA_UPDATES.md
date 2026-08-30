# OTA updates — shipping features without rebuilding the APK

Set up with `expo-updates` + EAS Update. The JS app (everything in `app/`
and `src/`) can now ship over the air in ~2 minutes. The native shell
(Kotlin/Swift, permissions) only changes via a full EAS build.

## How the phone receives updates

1. Student opens BT LOCKDOWN.
2. App checks `https://u.expo.dev/...` for a newer JS bundle on its channel.
3. Found + compatible → downloads in background.
4. **Next app launch** runs the new version. No Play Store, no reinstall.

Compatibility is automatic: `runtimeVersion.policy = "fingerprint"`.
A bundle only loads on a build with the same native fingerprint.
`app.config.js` hashes `modules/bt-lockdown-native/**` into the fingerprint,
so editing ANY Kotlin/Swift file automatically blocks the OTA update from
old APKs (they simply don't receive it) — an incompatible update can never
crash an installed app.

## Channels

| Build profile (`eas.json`) | Channel | Who runs it |
| --- | --- | --- |
| `preview` (APK, main-branch workflow) | `preview` | Testers / side-loaded phones |
| `production` (AAB) | `production` | Play Store students |
| `development` (dev client) | `development` | You, dev builds |

## Day-to-day: ship a JS-only feature

```bash
# 1. test on the preview channel first
eas update --branch preview --message "What changed"

# 2. install/refresh the preview APK on a test phone, open app twice,
#    confirm it works
# 3. promote the same code to students
eas update --branch production --message "What changed"
```

Branches auto-map to channels of the same name. Update messages show up in
the EAS dashboard.

## When you MUST do a full EAS build instead

Push to `main` (triggers `.eas/workflows/build-android.yml`) — or
`eas build -p android --profile preview` manually — whenever you touch:

- `modules/bt-lockdown-native/**` (Kotlin / Swift native code)
- `plugins/withBTLockdown.js`
- permissions / icon / package name in `app.json`
- add or upgrade a dependency with native code (run `npx expo install`)
- `app.json` `version` bump for the store

Normal rule of thumb: if it's only in `app/`, `src/`, or plain JS
dependencies, `eas update` is enough.

After a new native build lands on phones, `eas update` works again for
JS changes on top of that build.

## Useful checks

```bash
npx expo config --type public     # see resolved config incl. updates URL
eas update:list                   # see published updates per branch
```

## Prereqs on a fresh machine

`npm install` (gives you `expo-updates`); EAS commands need
`npx eas-cli` and being logged into the `bingen` Expo account
the project already belongs to.
