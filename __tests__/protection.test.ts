/**
 * The protection summary is the only place the app tells the student, the parent
 * and the teacher how protected the phone is. These tests pin the part that
 * matters: it must never report more than the device verified, and the loss of
 * one layer must be visible while the other layer keeps holding.
 */
import { penaltyFor } from '@/src/services/penalties';
import {
  formatDuration,
  modeLabel,
  summarizeProtection,
  type ProtectionStatus,
} from '@/src/services/protection';

const base = (over: Partial<ProtectionStatus> = {}): ProtectionStatus => ({
  mode: 'apps',
  consent: true,
  deviceOwner: false,
  state: 'ACTIVE',
  detail: 'tunnel up; netd routing; sync path excluded; server reachable',
  statusLine: 'internet blocked (shield apps)',
  protection: 'FULL',
  sealed: true,
  onBreak: false,
  breakSecondsLeft: 0,
  breakCount: 0,
  breakMinutesCap: 15,
  breaksCap: 2,
  blockedForSeconds: 61,
  ceilingSeconds: 28800,
  revokeCount: 0,
  tunnelCount: 1,
  failStreak: 0,
  vpnPrepared: true,
  tunnelUp: true,
  vpnNetworkSeen: true,
  selfExcluded: true,
  controlChannelOk: true,
  lockVpnUi: false,
  alwaysOnVpn: false,
  capturedApps: 12,
  seal: {
    enforcing: true,
    listedInSettings: true,
    boundInProcess: true,
    dropCount: 0,
    restoreCount: 0,
    lastDropAt: 0,
    lastDropWhy: '',
    liveAgeSeconds: 1,
    watching: true,
  },
  ...over,
});

describe('summarizeProtection', () => {
  it('reports Full protection only when both layers are verified', () => {
    const s = summarizeProtection(base());
    expect(s.level).toBe('FULL');
    expect(s.tone).toBe('mint');
    expect(s.headline).toBe('Full protection');
    expect(s.detail).toContain('internet blocked for shielded apps');
    // A sealed session is never switchable off from the app: the way out is the
    // timetable / the teacher ending the session.
    expect(s.canRelease).toBe(false);
  });

  it('says "sealed, internet open" when the shield is off — no fake full lock', () => {
    const s = summarizeProtection(
      base({ mode: 'off', state: 'OFF', protection: 'SEAL_ONLY', statusLine: 'off', alwaysOnVpn: false })
    );
    expect(s.level).toBe('SEAL_ONLY');
    expect(s.headline).toBe('Sealed · internet open');
    expect(s.tone).toBe('amber');
  });

  it('keeps the network layer visible when the seal is lost (the case this exists for)', () => {
    const s = summarizeProtection(
      base({
        protection: 'NETWORK_ONLY',
        seal: { ...base().seal!, enforcing: false, listedInSettings: false, boundInProcess: false },
      })
    );
    expect(s.headline).toBe('Seal service off · internet blocked');
    expect(s.tone).toBe('crimson');
    expect(s.action).toBe('re-enable-seal');
    expect(s.detail).toContain('12 shielded app(s) have no internet');
  });

  it('treats a user disconnect as protection down, and never as a mode to re-arm silently', () => {
    const s = summarizeProtection(base({ protection: 'DEGRADED', state: 'REVOKED_BY_USER', tunnelUp: false }));
    expect(s.headline).toContain('VPN disconnected');
    expect(s.tone).toBe('crimson');
    expect(s.canRelease).toBe(false);
    expect(s.needsConsent).toBe(false);
  });

  it('does not blame the student when the device refused the tunnel', () => {
    const s = summarizeProtection(
      base({ protection: 'SEAL_ONLY', state: 'FAILED', tunnelUp: false, detail: 'establish() returned null' })
    );
    expect(s.headline).toBe('Sealed · internet open');
    expect(s.detail).toContain('establish() returned null');
    // Not a consent problem and not tamper: the seal keeps working on its own.
    expect(s.needsConsent).toBe(false);
    expect(s.action).toBe('none');
    // Both layers down + the device refused the tunnel => the fix offered is the
    // battery/keep-alive path, never "re-arm silently".
    const down = summarizeProtection(
      base({ protection: 'DEGRADED', state: 'FAILED', tunnelUp: false, seal: { ...base().seal!, enforcing: false } })
    );
    expect(down.tone).toBe('crimson');
    expect(down.action).toBe('battery');
  });

  it('offers a break only while Full and while breaks remain', () => {
    expect(summarizeProtection(base()).canBreak).toBe(true);
    expect(summarizeProtection(base({ breakCount: 2 })).canBreak).toBe(false);
    const onBreak = summarizeProtection(
      base({ state: 'ON_BREAK', protection: 'NETWORK_ONLY', onBreak: true, breakSecondsLeft: 240 })
    );
    expect(onBreak.headline).toBe('Break — internet allowed');
    expect(onBreak.detail).toContain('4 min left');
    expect(onBreak.canRelease).toBe(false);
  });

  it('shows the consent card for a device-owner-less install that has not been approved', () => {
    const s = summarizeProtection(base({ sealed: false, vpnPrepared: false, state: 'STARTING', protection: 'IDLE' }));
    expect(s.action).toBe('consent');
    expect(s.needsConsent).toBe(true);
  });

  it('lets the shield be switched off only between sessions', () => {
    const off = summarizeProtection(base({ sealed: false, mode: 'off', state: 'OFF', protection: 'IDLE' }));
    expect(off.headline).toBe('Idle — no session');
    expect(off.canRelease).toBe(false); // nothing armed to release

    const armed = summarizeProtection(base({ sealed: false, state: 'OFF', protection: 'IDLE', mode: 'strict' }));
    expect(armed.headline).toBe('Shield armed for the next session');
    expect(armed.canRelease).toBe(true);
    expect(armed.action).toBe('none'); // vpnPrepared is true in the fixture

    const armedNoGrant = summarizeProtection(
      base({ sealed: false, state: 'OFF', protection: 'IDLE', mode: 'strict', vpnPrepared: false })
    );
    expect(armedNoGrant.action).toBe('consent');
  });

  it('is honest outside a native build instead of claiming protection', () => {
    const s = summarizeProtection(null, {
      accessibility: 'unavailable',
      overlay: 'unavailable',
      battery: 'unavailable',
      admin: 'unavailable',
      owner: 'unavailable',
      kiosk: 'unavailable',
      network: 'unavailable',
      protection: 'unknown',
      miui: 'none',
      notifications: 'pending',
    });
    expect(s.headline).toBe('Enforcement not linked');
    expect(s.tone).toBe('muted');
    expect(s.action).toBe('none');
  });

  it('never inflates the level from the shield alone', () => {
    const netOnly = summarizeProtection(
      base({ protection: 'NETWORK_ONLY', seal: { ...base().seal!, enforcing: false } })
    );
    const bothDown = summarizeProtection(
      base({
        protection: 'DEGRADED',
        state: 'OFF',
        tunnelUp: false,
        seal: { ...base().seal!, enforcing: false, listedInSettings: false },
      })
    );
    expect(netOnly.level).not.toBe('FULL');
    expect(bothDown.level).toBe('DEGRADED');
    expect(bothDown.headline).toBe('Protection down — device hard-sealed');
    expect(bothDown.tone).toBe('crimson');
  });
});

describe('modeLabel', () => {
  it('names what each mode actually blocks', () => {
    expect(modeLabel('off')).toBe('Off');
    expect(modeLabel('apps')).toContain('school apps stay online');
    expect(modeLabel('strict')).toContain('no internet for anything but BT LOCKDOWN');
  });
});

describe('formatDuration', () => {
  it('formats seconds for the readout', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(61)).toBe('01:01');
    expect(formatDuration(3600 + 60)).toBe('1:01:00');
    expect(formatDuration(-5)).toBe('00:00');
  });
});

describe('penalties for the second layer', () => {
  it('scores disabling the network shield like disabling the seal', () => {
    expect(penaltyFor('network_shield_off', 1)).toEqual({ eloDelta: -50, breakStreak: true, scored: true });
  });

  it('scores disabling the seal the same as before', () => {
    expect(penaltyFor('accessibility_off', 1).eloDelta).toBe(-50);
  });
});
