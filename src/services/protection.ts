/**
 * Protection summary — the single place the UI turns the native health
 * controller's numbers into words.
 *
 * The rule this file exists to enforce: **never claim more than the device
 * verified.** The native side computes the level (it is the only one that can
 * see the seal binding and the routing state), and JS only renders it:
 *
 *   FULL          seal service bound AND network shield verified enforcing
 *   SEAL_ONLY     launches intercepted, internet still available
 *   NETWORK_ONLY  seal service lost, but shielded apps have no internet
 *   DEGRADED      neither layer verified — the phone is hard-sealed instead
 *
 * So a lost accessibility service is reported as "seal service off — internet
 * blocked" rather than "BT LOCKDOWN is running", and the fix is one tap away.
 */
import type { DeviceGuard } from '@/src/services/lockdownNative';

export type ShieldMode = 'off' | 'apps' | 'strict';

export type ShieldState =
  | 'OFF'
  | 'STARTING'
  | 'ACTIVE'
  | 'ON_BREAK'
  | 'DEGRADED'
  | 'FAILED'
  | 'REVOKED_BY_USER'
  | 'NEEDS_CONSENT'
  | 'NEEDS_VPN_PERMISSION';

export type ProtectionLevel = 'FULL' | 'SEAL_ONLY' | 'NETWORK_ONLY' | 'DEGRADED' | 'IDLE' | 'unknown';

/** Mirrors NetworkProtectionManager.snapshot() + the seal health block. */
export interface ProtectionStatus {
  mode: ShieldMode;
  consent: boolean;
  deviceOwner: boolean;
  state: ShieldState;
  detail: string;
  statusLine: string;
  protection: ProtectionLevel | 'unknown';
  sealed: boolean;
  onBreak: boolean;
  breakSecondsLeft: number;
  breakCount: number;
  breakMinutesCap: number;
  breaksCap: number;
  blockedForSeconds: number;
  ceilingSeconds: number;
  revokeCount: number;
  tunnelCount: number;
  failStreak: number;
  vpnPrepared: boolean;
  tunnelUp: boolean;
  vpnNetworkSeen: boolean;
  selfExcluded: boolean;
  controlChannelOk: boolean;
  lockVpnUi: boolean;
  alwaysOnVpn: boolean;
  capturedApps: number;
  seal?: {
    enforcing: boolean;
    listedInSettings: boolean;
    boundInProcess: boolean;
    dropCount: number;
    restoreCount: number;
    lastDropAt: number;
    lastDropWhy: string;
    liveAgeSeconds: number;
    watching: boolean;
  };
  sealGuidance?: string;
}

export interface ProtectionSummary {
  /** What the seal actually is, for the pill / badge. */
  level: ProtectionLevel;
  headline: string;
  detail: string;
  tone: 'mint' | 'amber' | 'crimson' | 'muted';
  /** True when the student/parent can switch the shield off from this screen. */
  canRelease: boolean;
  /** True when the system VPN allowance or the consent card still needs a tap. */
  needsConsent: boolean;
  /** True when a network break can be granted right now. */
  canBreak: boolean;
  /** The one action that fixes the current state, if any. */
  action: 'none' | 'consent' | 're-enable-seal' | 'battery' | 'break' | 'release';
}

const IDLE_SUMMARY: ProtectionSummary = {
  level: 'unknown',
  headline: 'Enforcement not linked',
  detail: 'Build the BT LOCKDOWN APK to arm the seal and the network shield.',
  tone: 'muted',
  canRelease: false,
  needsConsent: false,
  canBreak: false,
  action: 'none',
};

export function summarizeProtection(p: ProtectionStatus | null, guard?: DeviceGuard | null): ProtectionSummary {
  if (!p) return IDLE_SUMMARY;
  const level: ProtectionLevel = p.protection === 'unknown' ? 'unknown' : p.protection;
  const sealOn = p.seal?.enforcing ?? false;
  const netActive = p.state === 'ACTIVE';

  // Nothing sealed: the shield is a policy for the session, so say what it is
  // armed for rather than implying traffic is being dropped now.
  if (!p.sealed) {
    if (p.mode === 'off') {
      return {
        level: 'IDLE',
        headline: 'Idle — no session',
        detail:
          guard?.owner === 'granted'
            ? 'Network shield is off. A school-managed device can arm it for every session.'
            : 'Network shield is off. Enable it to keep social apps offline during Deep Work.',
        tone: 'muted',
        canRelease: false,
        needsConsent: false,
        canBreak: false,
        action: 'none',
      };
    }
    return {
      level: 'IDLE',
      headline: 'Shield armed for the next session',
      detail: `${modeLabel(p.mode)} · starts the moment Deep Work starts and releases when it ends.`,
      tone: 'mint',
      canRelease: true,
      needsConsent: !p.vpnPrepared && !p.deviceOwner,
      canBreak: false,
      action: !p.vpnPrepared && !p.deviceOwner ? 'consent' : 'none',
    };
  }

  if (p.state === 'ON_BREAK') {
    return {
      level,
      headline: 'Break — internet allowed',
      detail: `${Math.ceil(p.breakSecondsLeft / 60)} min left, then the block returns. The seal itself stays up.`,
      tone: 'amber',
      // A break is a window, not a way out: releasing the shield mid-session is
      // refused natively, so the UI must not offer it either.
      canRelease: false,
      needsConsent: false,
      canBreak: false,
      action: 'none',
    };
  }

  if (level === 'FULL') {
    return {
      level,
      headline: 'Full protection',
      detail:
        `Launches intercepted and ${p.mode === 'strict' ? 'internet blocked for all apps' : 'internet blocked for shielded apps'}` +
        (p.alwaysOnVpn ? ' · OS-owned always-on tunnel' : '') +
        ` · ${formatDuration(p.blockedForSeconds)} blocked.`,
      tone: 'mint',
      canRelease: false,
      needsConsent: false,
      canBreak: p.breakCount < p.breaksCap,
      action: p.breakCount < p.breaksCap ? 'break' : 'none',
    };
  }

  if (level === 'SEAL_ONLY') {
    return {
      level,
      headline: 'Sealed · internet open',
      detail:
        'Apps are intercepted, but the network shield is not enforcing' +
        (p.state === 'NEEDS_CONSENT' || p.state === 'NEEDS_VPN_PERMISSION'
          ? ' — the system VPN allowance is still needed.'
          : p.state === 'FAILED'
            ? ` — ${p.detail}`
            : '.'),
      tone: 'amber',
      canRelease: false,
      needsConsent: p.state === 'NEEDS_CONSENT' || p.state === 'NEEDS_VPN_PERMISSION',
      canBreak: false,
      action: p.state === 'NEEDS_CONSENT' || p.state === 'NEEDS_VPN_PERMISSION' ? 'consent' : 'none',
    };
  }

  if (level === 'NETWORK_ONLY') {
    return {
      level,
      headline: 'Seal service off · internet blocked',
      detail:
        `The accessibility seal was lost${sealOn ? '' : ' and has not come back'}, so app launches are not ` +
        `being intercepted — but ${p.mode === 'strict' ? 'the device has no usable internet' : `${p.capturedApps} shielded app(s) have no internet`} while the session runs. ` +
        `Re-enable the seal service to get Full Protection back.` +
        (p.revokeCount > 0 ? ` (${p.revokeCount} disconnect${p.revokeCount === 1 ? '' : 's'} recorded.)` : ''),
      tone: 'crimson',
      canRelease: false,
      needsConsent: false,
      canBreak: false,
      action: 're-enable-seal',
    };
  }

  if (p.state === 'DEGRADED') {
    return {
      level: 'DEGRADED',
      headline: 'Shield degraded',
      detail: `Tunnel is up but not verified as blocking: ${p.detail}. The seal keeps enforcing meanwhile.`,
      tone: 'amber',
      canRelease: false,
      needsConsent: false,
      canBreak: false,
      action: 'none',
    };
  }

  // DEGRADED / REVOKED_BY_USER / FAILED while sealed: neither layer is verified.
  return {
    level: 'DEGRADED',
    headline:
      p.state === 'REVOKED_BY_USER'
        ? 'Protection down — VPN disconnected on this device'
        : 'Protection down — device hard-sealed',
    detail:
      (p.state === 'REVOKED_BY_USER'
        ? 'The network shield was switched off here, so shielded apps have internet again. '
        : p.state === 'FAILED'
          ? 'This device refused the block tunnel. '
          : 'Neither enforcement layer is verified. ') +
      (p.sealGuidance ? ` ${p.sealGuidance}` : ' The phone stays locked until the session ends.'),
    tone: 'crimson',
    canRelease: false,
    needsConsent: p.state === 'FAILED',
    canBreak: false,
    action: p.state === 'FAILED' ? 'battery' : 're-enable-seal',
  };
}

export function modeLabel(mode: ShieldMode): string {
  if (mode === 'strict') return 'Strict — no internet for anything but BT LOCKDOWN';
  if (mode === 'apps') return 'Shield apps only — school apps stay online';
  return 'Off';
}

/** Compact mm:ss / h:mm:ss for the "blocked for" readout. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
