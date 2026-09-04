/**
 * Source guards for the "setup once, then a banner + notification" behaviour.
 *
 * These read the actual files because the failure mode is a *future edit* putting
 * the screen hijack back: it looks reasonable ("permissions are missing → show the
 * permissions screen") and it is exactly what made the app feel stuck on Xiaomi /
 * Redmi, where the accessibility seal drops many times a day. A unit test of
 * computeAttention() cannot catch a call site that ignores it, so the call sites are
 * pinned here instead.
 */
const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const state = read('src', 'store', 'AppState.tsx');
const home = read('app', '(app)', 'index.tsx');
const permissionsScreen = read('app', 'permissions.tsx');
const overlay = read(
  'modules',
  'bt-lockdown-native',
  'android',
  'src',
  'main',
  'java',
  'com',
  'btsoftware',
  'lockdown',
  'LockdownOverlayService.kt'
);

describe('no permissions-screen hijack after first run', () => {
  const armBlock = state.slice(state.indexOf('const arm = useCallback'), state.indexOf('const disarm = useCallback'));

  it('arm() still refuses to fake a session it cannot enforce', () => {
    expect(armBlock).toMatch(/getDeviceGuard\(\)/);
    expect(armBlock).toMatch(/accessibility !== 'granted'/);
  });

  it('arm() routes to setup ONLY when setup was never completed', () => {
    expect(armBlock.match(/gate: 'permissions'/g) || []).toHaveLength(1);
    expect(armBlock).toMatch(
      /if \(!stateRef\.current\.setupDone\) dispatch\(\{ type: 'SET_GATE', gate: 'permissions' \}\);/
    );
  });

  it('arm() re-reads the grants so the banner is fed instead of the router', () => {
    expect(armBlock).toMatch(/refreshPermsRef\.current\?\.\(\)/);
  });

  it('a restored seal clears the prompt by itself', () => {
    const events = state.slice(state.indexOf("case 'a11yRestored'"), state.indexOf("case 'overlayDenied'"));
    expect(events).toMatch(/refreshPermsRef/);
  });

  it('setup completion is persisted, or the hijack comes back after every restart', () => {
    expect(state).toMatch(/case 'SET_SETUP_DONE'/);
    expect(state).toMatch(/setupDone: Boolean\(saved\.setupDone \?\? saved\.permissions\)/);
    expect(state).toMatch(/setupDone: state\.setupDone,/); // written by the persist effect
  });
});

describe('banner is the only in-app prompt on Home', () => {
  it('Home renders the attention banner', () => {
    expect(home).toMatch(/<AttentionBanner \/>/);
    expect(home).toMatch(/from '@\/src\/components\/AttentionBanner'/);
  });

  it('the banner never replaces a screen (no router.replace, no modal)', () => {
    const banner = read('src', 'components', 'AttentionBanner.tsx');
    expect(banner).not.toMatch(/router\.replace/);
    expect(banner).not.toMatch(/Modal/);
    expect(banner).toMatch(/snoozeAttention\(SNOOZE_MS\)/);
  });
});

describe('the setup screen stops hammering the system for state', () => {
  it('no unconditional 2.5 s guard poll (that is the sticky-feeling part)', () => {
    expect(permissionsScreen).not.toMatch(/setInterval\(read, 2500\)/);
  });

  it('re-reads when the app comes back from system Settings', () => {
    expect(permissionsScreen).toMatch(/AppState\.addEventListener\('change'/);
    expect(permissionsScreen).toMatch(/next === 'active'/);
  });

  it('reads bypass the guard cache while a grant is in flight', () => {
    expect(permissionsScreen).toMatch(/getDeviceGuard\(true\)/);
  });
});

describe('native alert notification', () => {
  it('has its own high-importance channel (the ongoing one must stay silent)', () => {
    expect(overlay).toMatch(/ALERT_CHANNEL = "bt_lockdown_alert"/);
    expect(overlay).toMatch(/IMPORTANCE_HIGH/);
  });

  it('is posted, throttled and cancelled from one place', () => {
    expect(overlay).toMatch(/private fun syncSealAlert\(why: String\)/);
    expect(overlay).toMatch(/ALERT_THROTTLE_MS/);
    expect(overlay).toMatch(/\.cancel\(ALERT_ID\)/);
    expect(overlay).toMatch(/fun dismissSealAlert\(ctx: Context\)/);
  });

  it('stays silent until the seal was enabled once or a session is running', () => {
    expect(overlay).toMatch(/if \(!everEnabled && !sealed\) return/);
  });

  it('is evaluated on the idle tick before any early return', () => {
    const idle = overlay.slice(overlay.indexOf('private fun tickIdle()'));
    expect(idle.slice(0, 700)).toMatch(/try \{ syncSealAlert\("idle"\) \} catch/);
  });
});
