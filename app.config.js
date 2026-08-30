/**
 * Dynamic Expo config.
 *
 * app.config.js runs whenever the app config is read (expo start, EAS Build,
 * `eas update`). We use it to hash the hand-written native sources in
 * modules/bt-lockdown-native and bake the hash into `extra.nativeSourceHash`.
 *
 * Why: the JS app is shipped to installed phones over EAS Update (OTA). The
 * runtime version policy is "fingerprint" (see app.json) — an OTA update only
 * loads on a phone whose native build fingerprint matches the update's.
 * @expo/fingerprint automatically sees dependencies, app.json permissions and
 * this repo's plugins/withBTLockdown.js file, but it does NOT see the
 * Kotlin/Swift sources that the config plugin copies into the native project
 * during prebuild. Hashing them here means editing ANY native source
 * automatically changes the fingerprint, so an incompatible JS update can
 * never land on an old native build.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashNativeSources() {
  const roots = [
    path.join(__dirname, 'modules', 'bt-lockdown-native', 'android'),
    path.join(__dirname, 'modules', 'bt-lockdown-native', 'ios'),
  ];
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  roots.forEach(walk);
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    hash.update(path.relative(__dirname, f).split(path.sep).join('/'));
    hash.update(fs.readFileSync(f));
  }
  return hash.digest('hex').slice(0, 16);
}

module.exports = ({ config }) => {
  config.extra = {
    ...(config.extra || {}),
    nativeSourceHash: hashNativeSources(),
  };
  return config;
};
