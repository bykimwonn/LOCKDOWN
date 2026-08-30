#!/usr/bin/env node
/**
 * AndroidManifest guardrail (EAS build breaker, Aug 2026).
 *
 * A config plugin once appended `uses-permission` to `cfg.modResults` instead of
 * `cfg.modResults.manifest`. That left a second element next to <manifest>, the XML
 * writer wrapped the whole file in a synthetic <root>, and the EAS build died deep in
 * eas-cli's update-channel step with:
 *
 *   Setting the update request headers in 'AndroidManifest.xml' to '{"expo-channel-name":"preview"}'
 *   Invalid manifest found at: .../android/app/src/main/AndroidManifest.xml
 *
 * Unit tests cover plugins/withBTLockdown.js in isolation; this check covers the
 * *generated* file, i.e. every config plugin in the chain together (expo-router,
 * expo-asset, expo-font, expo-updates and ours). Run it after
 * `npx expo prebuild -p android --no-install --clean`.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');

const MANIFEST_PATH = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const REQUEST_HEADERS = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY';
const REQUIRED_PERMISSION = 'android.permission.RECEIVE_BOOT_COMPLETED';

let failed = false;
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  failed = true;
};

if (!existsSync(MANIFEST_PATH)) {
  fail(
    `${MANIFEST_PATH} not found.\n  Generate it first:  npx expo prebuild -p android --no-install --clean`
  );
  process.exit(1);
}

const raw = readFileSync(MANIFEST_PATH, 'utf8');

// The exact symptom of a mod writing outside <manifest>.
if (/<root[\s>/]/.test(raw)) {
  fail(
    `${MANIFEST_PATH} is wrapped in a synthetic <root> element.\n` +
      '  A config plugin wrote a sibling of <manifest> (e.g. cfg.modResults["uses-permission"]\n' +
      '  instead of cfg.modResults.manifest["uses-permission"]). Android and Expo both reject this.'
  );
}

let doc;
try {
  // Same reader eas-cli's build-tools use to bake the channel into the manifest —
  // this is the call that failed the build.
  doc = await AndroidConfig.Manifest.readAndroidManifestAsync(MANIFEST_PATH);
  console.log('Manifest parses as <manifest> via @expo/config-plugins.');
} catch (e) {
  fail(`${MANIFEST_PATH} is not readable: ${e.message}`);
  process.exit(1);
}

const topLevel = Object.keys(doc).filter((k) => !k.startsWith('_'));
if (topLevel.length !== 1 || topLevel[0] !== 'manifest') {
  fail(`Expected <manifest> to be the only root element, found: ${topLevel.join(', ')}`);
}

const permissions = (doc.manifest['uses-permission'] ?? []).map((p) => p.$?.['android:name']);
if (!permissions.includes(REQUIRED_PERMISSION)) {
  fail(
    `${REQUIRED_PERMISSION} is missing from <manifest> — BootReceiver cannot relaunch the\n` +
      '  watchdog after a reboot. plugins/withBTLockdown.js adds it; check that it still lands\n' +
      '  inside <manifest> (not beside it).'
  );
} else {
  console.log(`${REQUIRED_PERMISSION} present inside <manifest>.`);
}

try {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(doc);
  const declared = (list) => (app[list] ?? []).map((e) => e.$?.['android:name']);
  for (const name of [
    'com.btsoftware.lockdown.LockdownAccessibilityService',
    'com.btsoftware.lockdown.LockdownOverlayService',
  ]) {
    if (!declared('service').includes(name)) fail(`<service ${name}> missing from <application>`);
  }
  for (const name of [
    'com.btsoftware.lockdown.BootReceiver',
    'com.btsoftware.lockdown.LockdownAdminReceiver',
  ]) {
    if (!declared('receiver').includes(name)) fail(`<receiver ${name}> missing from <application>`);
  }
  if (!failed) console.log('Lockdown services + receivers are wired inside <application>.');
} catch (e) {
  fail(`Could not read <application> from the manifest: ${e.message}`);
}

// eas-cli writes this meta-data itself, so it is usually absent right after prebuild and
// only needs validating when something (eas update:configure, or a bare-workflow manifest
// kept in git) has already put it there.
// Note: getMainApplicationMetaDataValue() returns null — not undefined — when the key is absent.
const headers = AndroidConfig.Manifest.getMainApplicationMetaDataValue(doc, REQUEST_HEADERS);
if (typeof headers === 'string' && headers.trim()) {
  // eas-cli merges its channel into this value, so it must stay parseable JSON.
  try {
    const parsed = JSON.parse(headers);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a JSON object');
    }
    console.log(`Update request headers meta-data parses as JSON: ${JSON.stringify(parsed)}`);
  } catch (e) {
    fail(`${REQUEST_HEADERS} in the manifest is not valid JSON (${e.message}): ${headers}`);
  }
}

// And the file must survive the write -> read round-trip the channel step performs.
try {
  const tmp = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'btml-')));
  const copy = path.join(tmp, 'AndroidManifest.xml');
  await AndroidConfig.Manifest.writeAndroidManifestAsync(copy, doc);
  await AndroidConfig.Manifest.readAndroidManifestAsync(copy);
  console.log('Manifest survives the write -> read round-trip (update-channel step).');
} catch (e) {
  fail(`Manifest does not round-trip through @expo/config-plugins: ${e.message}`);
}

if (failed) {
  console.error(`\nFix the config plugins, not this file. Offending manifest:\n${MANIFEST_PATH}`);
  process.exit(1);
}
console.log('\nGenerated AndroidManifest.xml is valid.');
