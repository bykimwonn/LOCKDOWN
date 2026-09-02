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

it('keeps every Kotlin file in the package the config plugin copies it into', () => {
  // plugins/withBTLockdown.js drops these files next to MainApplication.kt
  // (package com.btsoftware.lockdown). A wrong package declaration means the
  // class is never found at runtime even though the build succeeds.
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    expect(text.startsWith('package com.btsoftware.lockdown\n')).toBe(true);
  }
});
