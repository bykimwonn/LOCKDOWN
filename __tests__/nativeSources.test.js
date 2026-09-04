/**
 * Regression tests for the hand-written Kotlin in modules/bt-lockdown-native.
 *
 * These exist because an EAS Android release build failed with:
 *
 *   e: .../LockTaskController.kt:116:17 Unresolved reference 'setLockTaskModeState'.
 *   e: .../LockTaskController.kt:116:64 Unresolved reference 'LOCK_TASK_MODE_PINNED'.
 *   > Task :app:compileReleaseKotlin FAILED
 *
 * `harden()` called DevicePolicyManager#setLockTaskModeState() and
 * DevicePolicyManager#LOCK_TASK_MODE_PINNED. Neither exists: lock task mode is
 * entered with Activity.startLockTask() and configured with
 * setLockTaskPackages()/setLockTaskFeatures(), and LOCK_TASK_MODE_* lives on
 * ActivityManager. The JS checks (tsc, jest, contract, manifest) all passed —
 * nothing in this repo compiles the Kotlin, so a typo in an Android API is
 * invisible until EAS is 5 minutes into a Gradle build.
 *
 * This test is the cheap version of that feedback loop: it greps the native
 * sources for Android members that do NOT exist in the SDK. Add to
 * NON_EXISTENT_ANDROID_APIS every time one of these slips through, so the same
 * mistake can never be committed twice.
 */
const fs = require('fs');
const path = require('path');

const NATIVE_ROOT = path.join(
  __dirname,
  '..',
  'modules',
  'bt-lockdown-native',
  'android',
  'src',
  'main'
);

/**
 * Android members that look plausible, are not in the SDK, and therefore fail
 * :app:compileReleaseKotlin with "unresolved reference".
 */
const NON_EXISTENT_ANDROID_APIS = [
  {
    id: 'DevicePolicyManager#setLockTaskModeState',
    pattern: /setLockTaskModeState/,
    because:
      'no such DevicePolicyManager method — use Activity.startLockTask()/stopLockTask()',
  },
  {
    id: 'DevicePolicyManager#LOCK_TASK_MODE_PINNED',
    pattern: /DevicePolicyManager\.LOCK_TASK_MODE_(PINNED|LOCKED|NONE)/,
    because: 'LOCK_TASK_MODE_* constants live on ActivityManager, not DevicePolicyManager',
  },
  {
    // Network shield. Builder#setBlockingState (STATE_BLOCKING_UNTIL_CONNECTED)
    // exists in AOSP but is @hide: it is not in the compile SDK, so any use of it
    // fails the EAS build. Blocking never depends on it — the routes plus a
    // tunnel nobody reads do the job, and the admin-side lockdown flag is the
    // supported way to block traffic while the tunnel is down.
    id: 'VpnService.Builder#setBlockingState (@hide)',
    pattern: /\.setBlockingState\s*\(/,
    because:
      'not a public SDK method (@hide) — use addRoute("0.0.0.0", 0) + DevicePolicyManager#setAlwaysOnVpnPackage(admin, pkg, lockdown, allowlist)',
  },
  {
    // The always-on API only exists with the ComponentName receiver as first arg.
    id: 'DevicePolicyManager#setAlwaysOnVpnPackage(String, …) without admin',
    pattern: /setAlwaysOnVpnPackage\s*\(\s*(?:vpnPackage|ctx\.packageName|packageName|"com\.)/,
    because:
      'no such overload — it is setAlwaysOnVpnPackage(ComponentName admin, String vpnPackage, boolean lockdownEnabled[, Set allowlist])',
  },
  {
    id: 'VpnService#onRevoked (wrong callback name)',
    pattern: /\bonRevoked\s*\(/,
    because: 'the callback is VpnService#onRevoke() — no past tense, no arguments',
  },
  {
    id: 'an app-level "turn the internet off" switch',
    pattern: /\bset(?:Internet|Network|Wifi|MobileData)Enabled\s*\(|DevicePolicyManager\.setNetwork/,
    because:
      'no such API for a third-party app (and setWifiEnabled is removed for apps) — the supported mechanisms are a VpnService blackhole tunnel and always-on VPN + lockdown via Device Owner',
  },
  {
    id: 'UserManager#DISALLOW_NETWORK (not a real restriction)',
    pattern: /UserManager\.DISALLOW_NETWORK\b/,
    because: 'this constant does not exist; the VPN-related one is UserManager.DISALLOW_CONFIG_VPN',
  },
  {
    // The classic "plausible package" mistake: AccessibilityServiceInfo lives in
    // android.accessibilityservice (that is where FEEDBACK_ALL_MASK is), not in
    // android.view.accessibility. Unresolved reference at EAS build time.
    id: 'android.view.accessibility.AccessibilityServiceInfo',
    pattern: /import\s+android\.view\.accessibility\.AccessibilityServiceInfo\b/,
    because:
      'AccessibilityServiceInfo (and FEEDBACK_ALL_MASK) is in android.accessibilityservice, not android.view.accessibility',
  },
  {
    // Only the ComponentName overloads of the always-on VPN API are public.
    id: 'UserManager#DISALLOW_VPN_CONFIG (wrong constant name)',
    pattern: /UserManager\.DISALLOW_VPN_CONFIG\b/,
    because: 'the constant is UserManager.DISALLOW_CONFIG_VPN (config-<thing> naming), not DISALLOW_VPN_CONFIG',
  },
  {
    // Broke build fd392a25 (:app:compileReleaseKotlin, BTLockdownModule.kt).
    // `activity.isInLockTaskMode` / `currentActivity?.isInLockTaskMode` are
    // NOT Activity members. Only ActivityManager has isInLockTaskMode()
    // (deprecated in API 23) and getLockTaskModeState() (API 23+).
    id: 'Activity#isInLockTaskMode',
    pattern:
      /(?:\bactivity\b|\bcurrentActivity\b|\bval\s+a\b|\ba)\s*(?:\?)?\.\s*isInLockTaskMode|\bthis\.isInLockTaskMode\b/i,
    because:
      'isInLockTaskMode() is an ActivityManager method, not an Activity one — use ActivityManager.getLockTaskModeState() on API 23+',
  },
];

function kotlinSources() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.kt')) out.push(p);
    }
  };
  walk(path.join(NATIVE_ROOT, 'java'));
  return out;
}

/**
 * Drops comments so an explanation *about* a bad API (like the doc comment on
 * harden()) is not reported as a use of it.
 */
function stripComments(text) {
  return text
    // Block comments (incl. KDoc): blank them out but keep the newlines so the
    // reported line numbers still match the real file.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '')) // line comments
    .join('\n');
}

const sources = kotlinSources();

it('finds the Kotlin sources this test is meant to guard', () => {
  expect(sources.length).toBeGreaterThan(0);
  for (const name of [
    'BTLockdownModule.kt',
    'BTLockdownPackage.kt',
    'Bridge.kt',
    'BootReceiver.kt',
    'LockTaskController.kt',
    'LockdownAccessibilityService.kt',
    'LockdownAdminReceiver.kt',
    'LockdownOverlayService.kt',
    'NativeReporter.kt',
    'LockdownVpnService.kt',
    'NetworkProtectionManager.kt',
    'AccessibilityHealth.kt',
    'WatchdogAlarmReceiver.kt',
  ]) {
    expect(sources.some((f) => f.endsWith(name))).toBe(true);
  }
});

describe.each(NON_EXISTENT_ANDROID_APIS)('$id', (api) => {
  it('is not referenced anywhere in the native sources', () => {
    const hits = [];
    for (const file of sources) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      text.split(/\r?\n/).forEach((line, i) => {
        if (api.pattern.test(line)) {
          hits.push(
            `${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`
          );
        }
      });
    }
    if (hits.length) {
      throw new Error(
        `${api.id} does not exist in the Android SDK (${api.because}).\n` +
          `Compiling this fails ':app:compileReleaseKotlin' on EAS.\n  ` +
          hits.join('\n  ')
      );
    }
  });
});

/**
 * The JS bridge is hand-written, so a native method that is never declared in
 * src/services/lockdownNative.ts silently resolves to `undefined` at runtime
 * (LINKED?.x is optional-chained) and the UI just shows "unavailable" — which is
 * how a security feature disappears without a single error. Catch it here.
 */
it('declares every @ReactMethod in the JS bridge', () => {
  const module = sources.find((f) => f.endsWith('BTLockdownModule.kt'));
  const text = stripComments(fs.readFileSync(module, 'utf8'));
  const methods = [...text.matchAll(/@ReactMethod\s*\n\s*fun\s+(\w+)\s*\(/g)].map((m) => m[1]);
  expect(methods.length).toBeGreaterThan(10);
  const bridge = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'lockdownNative.ts'),
    'utf8'
  );
  const missing = methods.filter((name) => !new RegExp(`\\b${name}\\s*[:(]`).test(bridge));
  if (missing.length) {
    throw new Error(
      `These @ReactMethod names are missing from src/services/lockdownNative.ts ` +
        `(NativeLockdown type + LockdownNative wrapper):\n  ${missing.join('\n  ')}`
    );
  }
});

it('keeps every Kotlin file in the package the config plugin copies it into', () => {
  // plugins/withBTLockdown.js drops these files next to MainApplication.kt
  // (package com.btsoftware.lockdown). A wrong package declaration means the
  // class is never found at runtime even though the build succeeds.
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    expect(text.startsWith('package com.btsoftware.lockdown\n')).toBe(true);
  }
});
