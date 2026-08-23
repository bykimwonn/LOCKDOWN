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
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.service) app.service = [];

    const has = (name) => app.service.some((s) => s.$['android:name'] === name);

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
          'android:foregroundServiceType': 'dataSync',
        },
      });
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
