/**
 * Regression tests for plugins/withBTLockdown.js — Android manifest wiring.
 *
 * These exist because an EAS build failed with:
 *
 *   Setting the update request headers in 'AndroidManifest.xml' to '{"expo-channel-name":"preview"}'
 *   Invalid manifest found at: .../android/app/src/main/AndroidManifest.xml
 *
 * Cause: the `uses-permission` push wrote onto `cfg.modResults` instead of
 * `cfg.modResults.manifest`. That put a second element next to <manifest>, so the XML
 * writer emitted `<root><manifest>…</manifest><uses-permission/></root>`. eas-cli's
 * build-tools then re-read the file (to bake the channel into the update request
 * headers), found no <manifest> element and threw "Invalid manifest found at".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AndroidConfig } = require('expo/config-plugins');

const withBTLockdown = require('../plugins/withBTLockdown');

/** Minimal stand-in for the <manifest> Expo's template hands to the mods. */
function makeManifestDoc() {
  return {
    manifest: {
      $: {
        'xmlns:android': 'http://schemas.android.com/apk/res/android',
        package: 'com.btsoftware.lockdown',
      },
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET' } },
        { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } },
      ],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [{ $: { 'android:name': '.MainActivity' } }],
        },
      ],
    },
  };
}

/** Runs just the android.manifest mod that withBTLockdown registers. */
async function runManifestMod(doc) {
  const config = withBTLockdown({ name: 'BT LOCKDOWN', slug: 'bt-lockdown', mods: {} });
  const manifestMod = config.mods.android.manifest;
  expect(typeof manifestMod).toBe('function');
  const result = await manifestMod({
    modResults: doc,
    modRequest: { projectRoot: process.cwd(), platformProjectRoot: process.cwd() },
  });
  return result.modResults;
}

it('adds RECEIVE_BOOT_COMPLETED inside <manifest>, and keeps <manifest> the only root element', async () => {
  const doc = await runManifestMod(makeManifestDoc());

  // A second top-level key here is what produced the fatal <root> wrapper.
  expect(Object.keys(doc)).toEqual(['manifest']);

  const permissions = (doc.manifest['uses-permission'] ?? []).map((p) => p.$['android:name']);
  expect(permissions).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  // Existing permissions must survive.
  expect(permissions).toEqual(expect.arrayContaining(['android.permission.INTERNET']));
});

it('registers the services and receivers inside <application>', async () => {
  const doc = await runManifestMod(makeManifestDoc());
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(doc);

  expect((app.service ?? []).map((s) => s.$['android:name'])).toEqual(
    expect.arrayContaining([
      'com.btsoftware.lockdown.LockdownAccessibilityService',
      'com.btsoftware.lockdown.LockdownOverlayService',
    ])
  );
  expect((app.receiver ?? []).map((r) => r.$['android:name'])).toEqual(
    expect.arrayContaining([
      'com.btsoftware.lockdown.BootReceiver',
      'com.btsoftware.lockdown.LockdownAdminReceiver',
    ])
  );
});

it('adds the MAIN/LAUNCHER <queries> block for on-device app discovery', async () => {
  const doc = await runManifestMod(makeManifestDoc());

  const queries = doc.manifest['queries'] ?? [];
  const launcherIntents = queries.flatMap((q) => q.intent ?? []);
  const found = launcherIntents.some(
    (i) =>
      (i.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN') &&
      (i.category ?? []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER')
  );
  expect(found).toBe(true);

  // <queries> must precede <application> in the emitted XML.
  const keys = Object.keys(doc.manifest);
  expect(keys.indexOf('queries')).toBeLessThan(keys.indexOf('application'));

  // Idempotent: a second mod run must not duplicate the block.
  const twice = await runManifestMod(doc);
  expect((twice.manifest['queries'] ?? []).length).toBe(queries.length);
});

it('stays idempotent when the mod runs twice (prebuild + bare rebuild)', async () => {
  const once = await runManifestMod(makeManifestDoc());
  const twice = await runManifestMod(once);

  const countFor = (doc, name) =>
    (doc.manifest['uses-permission'] ?? []).filter((p) => p.$['android:name'] === name).length;
  expect(countFor(twice, 'android.permission.RECEIVE_BOOT_COMPLETED')).toBe(1);

  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(twice);
  expect(app.service.filter((s) => s.$['android:name'].endsWith('LockdownOverlayService'))).toHaveLength(1);
  expect(app.receiver.filter((r) => r.$['android:name'].endsWith('BootReceiver'))).toHaveLength(1);
});

it('survives the write -> read round-trip that the EAS update-channel step performs', async () => {
  const doc = await runManifestMod(makeManifestDoc());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-lockdown-manifest-'));
  const file = path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml');

  // Same helpers eas-cli's build-tools uses (writeAndroidManifestAsync / readAndroidManifestAsync).
  await AndroidConfig.Manifest.writeAndroidManifestAsync(file, doc);
  const xml = fs.readFileSync(file, 'utf8');
  expect(xml).not.toMatch(/<root>/);
  expect(xml.trimStart().startsWith('<manifest')).toBe(true);

  // readAndroidManifestAsync throws "Invalid manifest found at: …" on a broken file.
  const reread = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
  expect(reread.manifest).toBeDefined();

  // The channel step also JSON-parses the request-headers meta-data it writes, so make
  // sure a quoted value round-trips through this manifest.
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(reread);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    app,
    'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY',
    JSON.stringify({ 'expo-channel-name': 'preview' }),
    'value'
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(file, reread);
  const finalDoc = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
  const headers = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
    finalDoc,
    'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'
  );
  expect(JSON.parse(headers)).toEqual({ 'expo-channel-name': 'preview' });
});
