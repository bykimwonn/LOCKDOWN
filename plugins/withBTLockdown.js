const {
  withAndroidManifest,
  withStringsXml,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Injects Accessibility + overlay services and copies Kotlin sources.
 * Never overwrite Expo's res/values/strings.xml — that deletes app_name
 * and is what blew up the first EAS Gradle run.
 */
function withBTLockdown(config) {
  config = withAndroidManifest(config, (cfg) => {
    // modResults is the whole XML *document*: { manifest: { $, uses-permission, application, … } }.
    // `app` is the <application> element; `doc` is the <manifest> element itself.
    const manifest = cfg.modResults;
    const doc = manifest.manifest ?? manifest;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.service) app.service = [];
    if (!app.receiver) app.receiver = [];

    const has = (name) => app.service.some((s) => s.$['android:name'] === name);
    const hasReceiver = (name) => app.receiver.some((r) => r.$['android:name'] === name);

    if (!has('com.btsoftware.lockdown.LockdownAccessibilityService')) {
      app.service.push({
        $: {
          'android:name': 'com.btsoftware.lockdown.LockdownAccessibilityService',
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.accessibilityservice',
              'android:resource': '@xml/lockdown_accessibility_service',
            },
          },
        ],
      });
    }

    if (!has('com.btsoftware.lockdown.LockdownOverlayService')) {
      app.service.push({
        $: {
          'android:name': 'com.btsoftware.lockdown.LockdownOverlayService',
          'android:exported': 'false',
          // specialUse, NOT dataSync. Android 15+ (apps targeting API 35+):
          //  - dataSync foreground services are capped at 6h per 24h and may
          //    NOT be launched from a BOOT_COMPLETED receiver, which would
          //    kill the post-reboot watchdog restart.
          //  - specialUse has no time limit and is not on the boot-restricted
          //    list, so BootReceiver keeps working on Android 15/16.
          'android:foregroundServiceType': 'specialUse',
        },
        // Play Console / OS review label for the specialUse type. This app is
        // a student device lock: session enforcement + server synchronization
        // that must keep running while the phone is backgrounded/sealed.
        property: [
          {
            $: {
              'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value':
                'Student device lockdown: seals the device during teacher-assigned Deep Work sessions and keeps the session watchdog + BT LEARNING sync running while the app is backgrounded.',
            },
          },
        ],
      });
    }

    // Tier 1 #1: relaunch the watchdog after reboot if a session is armed.
    if (!hasReceiver('com.btsoftware.lockdown.BootReceiver')) {
      app.receiver.push({
        $: {
          'android:name': 'com.btsoftware.lockdown.BootReceiver',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
              { $: { 'android:name': 'com.htc.intent.action.QUICKBOOT_POWERON' } },
            ],
          },
        ],
      });
    }

    // Tier 1 #6: device-admin tripwire against uninstall / tampering.
    if (!hasReceiver('com.btsoftware.lockdown.LockdownAdminReceiver')) {
      app.receiver.push({
        $: {
          'android:name': 'com.btsoftware.lockdown.LockdownAdminReceiver',
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_DEVICE_ADMIN',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.app.action.DEVICE_ADMIN_ENABLED' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.app.device_admin',
              'android:resource': '@xml/lockdown_device_admin',
            },
          },
        ],
      });
    }

    // BOOT_COMPLETED is a normal install-time permission.
    // It must go INSIDE <manifest>, i.e. on doc['uses-permission'].
    // Writing it on modResults would put it next to the `manifest` key, and the
    // XML builder would then wrap the whole file in an extra <root> element,
    // producing an invalid manifest that breaks `expo prebuild`/EAS builds.
    const perms = doc['uses-permission'] ?? [];
    const ensurePerm = (name) => {
      if (!perms.some((p) => p.$ && p.$['android:name'] === name)) {
        perms.push({ $: { 'android:name': name } });
      }
    };
    ensurePerm('android.permission.RECEIVE_BOOT_COMPLETED');
    // Base foreground-service permission (install-time). Templates usually
    // include it, but the always-on "BT LOCKDOWN is running" notification +
    // watchdog must not depend on that — declare it explicitly.
    ensurePerm('android.permission.FOREGROUND_SERVICE');
    // specialUse foreground service (Android 14+ requires a type permission).
    ensurePerm('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    doc['uses-permission'] = perms;

    // Guard: the parsed document is `{ manifest: { … } }`, so `manifest` must stay the
    // ONLY top-level key. Any sibling (e.g. a `uses-permission` written on modResults)
    // makes the XML writer emit `<root><manifest>…</manifest><uses-permission/></root>`,
    // and the build then dies much later with the unhelpful
    // "Invalid manifest found at: android/app/src/main/AndroidManifest.xml" from the
    // expo-updates channel step. Fail here, at the real cause, instead.
    if (manifest.manifest) {
      const stray = Object.keys(manifest).filter((k) => k !== 'manifest' && !k.startsWith('_'));
      if (stray.length) {
        throw new Error(
          'withBTLockdown: the AndroidManifest mod left ' +
            stray.map((k) => `<${k}>`).join(', ') +
            ' outside <manifest>. Mutate cfg.modResults.manifest[...] (not cfg.modResults[...]) in plugins/withBTLockdown.js.'
        );
      }
    }

    return cfg;
  });

  config = withStringsXml(config, (cfg) => {
    const items = cfg.modResults.resources.string ?? [];
    if (!items.some((s) => s.$ && s.$.name === 'accessibility_description')) {
      items.push({
        $: { name: 'accessibility_description' },
        _: 'BT LOCKDOWN intercepts distracting apps during Deep Work sessions from BT LEARNING.',
      });
      cfg.modResults.resources.string = items;
    }
    if (!items.some((s) => s.$ && s.$.name === 'admin_description')) {
      items.push({
        $: { name: 'admin_description' },
        _: 'BT LOCKDOWN prevents the session seal from being removed mid-Deep Work. It never locks, wipes, or resets your device.',
      });
      cfg.modResults.resources.string = items;
    }
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('BTLockdownPackage')) {
      if (src.includes('PackageList(this).packages.apply')) {
        src = src.replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n            add(BTLockdownPackage())'
        );
      } else if (src.includes('val packages = PackageList(this).packages')) {
        src = src.replace(
          'val packages = PackageList(this).packages',
          'val packages = PackageList(this).packages\n            packages.add(BTLockdownPackage())'
        );
      }
      cfg.modResults.contents = src;
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcRoot = path.join(cfg.modRequest.projectRoot, 'modules/bt-lockdown-native/android/src/main');
      const destRoot = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main');

      copyTree(path.join(srcRoot, 'java'), path.join(destRoot, 'java'));

      const xmlFrom = path.join(srcRoot, 'res/xml');
      const xmlTo = path.join(destRoot, 'res/xml');
      copyTree(xmlFrom, xmlTo);

      return cfg;
    },
  ]);

  return config;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

module.exports = withBTLockdown;
