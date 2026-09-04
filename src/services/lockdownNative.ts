import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { getApiBase, getToken } from '@/src/config';
import type { PermissionStatus, ShieldApp } from '@/src/types';
import type { ProtectionStatus, ShieldMode } from '@/src/services/protection';

type NativeLockdown = {
  requestScreenTimeAuthorization: () => Promise<boolean>;
  requestAccessibility: () => Promise<boolean>;
  requestOverlay: () => Promise<boolean>;
  requestBatteryExemption: () => Promise<boolean>;
  requestDeviceAdmin: () => Promise<boolean>;
  openAutostartSettings: () => Promise<boolean>;
  isSamsungDevice: () => Promise<boolean>;
  startBackgroundGuard: () => Promise<boolean>;
  getProtectionStatus: () => Promise<ProtectionStatus>;
  setNetworkShield: (mode: string, consent: boolean, lockVpnUi: boolean) => Promise<ProtectionStatus & { state: string }>;
  requestNetworkShieldConsent: () => Promise<boolean>;
  grantNetworkBreak: (minutes: number) => Promise<boolean>;
  releaseNetworkShield: () => Promise<boolean>;
  setAccessibilityAllowlist: (enabled: boolean) => Promise<boolean>;
  openSealSettings: () => Promise<boolean>;
  showCornerTimer: (targetAt: number) => Promise<boolean>;
  hideCornerTimer: () => Promise<boolean>;
  enterKiosk: () => Promise<boolean>;
  exitKiosk: () => Promise<boolean>;
  isKiosk: () => Promise<boolean>;
  getPermissionStatus: () => Promise<PermissionStatus>;
  getDeviceGuard: () => Promise<DeviceGuard>;
  activate: (payload: {
    sessionId: string;
    endsAt: string;
    blockedPackages: string[];
    whitelistPackages: string[];
    title?: string;
    subject?: string;
    token?: string;
    apiBase?: string;
    armedBy?: string;
  }) => Promise<boolean>;
  updateShield: (payload: {
    blockedPackages: string[];
    whitelistPackages: string[];
  }) => Promise<boolean>;
  deactivate: () => Promise<boolean>;
  isEnforcing: () => Promise<boolean>;
  getInstalledApps: () => Promise<InstalledApp[]>;
};

export type InstalledApp = {
  packageId: string;
  name: string;
};

export type DeviceGuard = {
  accessibility: 'granted' | 'denied' | 'unavailable';
  overlay: 'granted' | 'denied' | 'unavailable';
  battery: 'granted' | 'denied' | 'unavailable';
  admin: 'granted' | 'denied' | 'unavailable';
  /** True when this app is provisioned as device owner. */
  owner: 'granted' | 'denied' | 'unavailable';
  /** True when the device is currently pinned in lock-task / kiosk mode. */
  kiosk: 'granted' | 'denied' | 'unavailable';
  /** Network shield mode: 'off' | 'apps' | 'strict'. Informational only. */
  network: ShieldMode | 'unavailable';
  /** What the health controller verified across BOTH layers. */
  protection: 'FULL' | 'SEAL_ONLY' | 'NETWORK_ONLY' | 'DEGRADED' | 'IDLE' | 'unknown';
  miui: 'detected' | 'none';
  notifications: string;
};

export type NativeLockdownEvent = {
  event:
    | 'blocked'
    | 'expired'
    | 'serverInactive'
    | 'unauthorized'
    | 'accessibilityOff'
    | 'a11yRestored'
    | 'adminDisabled'
    | 'overlayDenied'
    | 'heartbeatLost'
    | 'netProtectActive'
    | 'netProtectDegraded'
    | 'netProtectDown'
    | 'netRevoked'
    | 'netShieldOff';
  app?: string;
  reason?: string;
};

const LINKED: Partial<NativeLockdown> | undefined = NativeModules.BTLockdownModule;

const fallbackPerms = (): PermissionStatus => ({
  screenTime: Platform.OS === 'ios' ? 'unavailable' : 'unavailable',
  accessibility: Platform.OS === 'android' ? 'pending' : 'unavailable',
  overlay: Platform.OS === 'android' ? 'pending' : 'unavailable',
  notifications: 'pending',
});

function defaultGuard(): DeviceGuard {
  return {
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
  };
}

/**
 * Thin JS bridge.
 * - Real device (after `expo prebuild`): talks to the Android accessibility
 *   service + enforcement foreground service.
 * - Expo Go / dev / web: no enforcement (available === false). The app still
 *   syncs with BT LEARNING, but it cannot seal the phone — the UI says so
 *   instead of pretending.
 * - iOS: Family Controls build not wired yet — treated as unsupported.
 */
/**
 * Essential packages that always stay reachable while a session is sealed,
 * plus the set of shield apps the teacher left UNBLOCKED. The native
 * enforcement is default-deny: only this whitelist (+ the hard-allow system
 * apps like phone / SMS / in-call baked into the accessibility service) gets
 * through. Any app not on the shield at all, or that the teacher has marked
 * blocked, is intercepted — that is the "system level" lock.
 */
const essentialWhitelist = [
  'com.btsoftware.lockdown',
  'com.btsoftware.learning',
  'com.apple.mobilephone',
  'com.apple.MobileSMS',
  'com.android.dialer',
  'com.google.android.apps.messaging',
];

export const LockdownNative = {
  get available(): boolean {
    return Platform.OS === 'android' && Boolean(LINKED?.activate);
  },

  async requestScreenTimeAuthorization() {
    if (LINKED?.requestScreenTimeAuthorization) return LINKED.requestScreenTimeAuthorization();
    return false;
  },

  async requestAccessibility() {
    if (LINKED?.requestAccessibility) return LINKED.requestAccessibility();
    return false;
  },

  async requestOverlay() {
    if (LINKED?.requestOverlay) return LINKED.requestOverlay();
    return false;
  },

  async requestBatteryExemption() {
    if (LINKED?.requestBatteryExemption) return LINKED.requestBatteryExemption();
    return true; // nothing to exempt outside the real build
  },

  async requestDeviceAdmin() {
    if (LINKED?.requestDeviceAdmin) return LINKED.requestDeviceAdmin();
    return false; // no native layer (Expo Go / web / iOS)
  },

  async openAutostartSettings() {
    if (LINKED?.openAutostartSettings) return LINKED.openAutostartSettings();
    return false;
  },

  async isSamsungDevice() {
    if (LINKED?.isSamsungDevice) return LINKED.isSamsungDevice();
    return false;
  },

  /**
   * Keep the native enforcement service alive in the background (idle) so the
   * app can auto-activate on its AI timetable without the student reopening it.
   */
  async startBackgroundGuard() {
    if (LINKED?.startBackgroundGuard) return LINKED.startBackgroundGuard();
    return false;
  },

  /** Show the corner countdown chip counting down to targetAt (epoch ms). */
  async showCornerTimer(targetAt: number) {
    if (LINKED?.showCornerTimer) return LINKED.showCornerTimer(targetAt);
    return false;
  },

  async hideCornerTimer() {
    if (LINKED?.hideCornerTimer) return LINKED.hideCornerTimer();
    return false;
  },

  // ----------------------------------------------------------------
  // Network shield (third layer) + seal health
  // ----------------------------------------------------------------

  /** Verified state of both enforcement layers. */
  async getProtectionStatus(): Promise<ProtectionStatus | null> {
    if (Platform.OS !== 'android' || !LINKED?.getProtectionStatus) return null;
    return LINKED.getProtectionStatus().catch(() => null);
  },

  /**
   * Arm the network shield.
   * @param consent true only after the on-screen explanation was accepted; on a
   *   school device-owner device the institution's policy is the authority.
   * @param lockVpnUi device-owner only: also hide Settings → VPN while sealed, so
   *   the shield cannot be disconnected there. Opt-in, cleared at session end.
   */
  async setNetworkShield(mode: ShieldMode, consent: boolean, lockVpnUi = false) {
    if (LINKED?.setNetworkShield) {
      return LINKED.setNetworkShield(mode, consent, lockVpnUi).catch(() => null);
    }
    return null;
  },

  /** Launch the system VPN allowance dialog if it has not been answered. */
  async requestNetworkShieldConsent() {
    if (LINKED?.requestNetworkShieldConsent) return LINKED.requestNetworkShieldConsent().catch(() => false);
    return false;
  },

  /** Bounded internet-only break during a sealed session (seal stays up). */
  async grantNetworkBreak(minutes: number) {
    if (LINKED?.grantNetworkBreak) return LINKED.grantNetworkBreak(minutes).catch(() => false);
    return false;
  },

  /** Switch the shield off. Refused natively while a session is sealed. */
  async releaseNetworkShield() {
    if (LINKED?.releaseNetworkShield) return LINKED.releaseNetworkShield().catch(() => false);
    return false;
  },

  /** Device-owner only: permit no other accessibility service but ours. */
  async setAccessibilityAllowlist(enabled: boolean) {
    if (LINKED?.setAccessibilityAllowlist) return LINKED.setAccessibilityAllowlist(enabled).catch(() => false);
    return false;
  },

  /** Open Settings → Accessibility so a parent/teacher can restore the seal. */
  async openSealSettings() {
    if (LINKED?.openSealSettings) return LINKED.openSealSettings().catch(() => false);
    return false;
  },

  /** Pin the whole device in kiosk mode (device-owner only). */
  async enterKiosk() {
    if (LINKED?.enterKiosk) return LINKED.enterKiosk();
    return false;
  },

  /** Release kiosk / lock-task mode. */
  async exitKiosk() {
    if (LINKED?.exitKiosk) return LINKED.exitKiosk();
    return false;
  },

  async isKiosk() {
    if (LINKED?.isKiosk) return LINKED.isKiosk();
    return false;
  },

  async getDeviceGuard(): Promise<DeviceGuard> {
    if (Platform.OS === 'android' && LINKED?.getDeviceGuard) return LINKED.getDeviceGuard();
    return defaultGuard();
  },

  async getPermissionStatus(): Promise<PermissionStatus> {
    if (LINKED?.getPermissionStatus) return LINKED.getPermissionStatus();
    return fallbackPerms();
  },

  async activate(
    sessionId: string,
    endsAt: string,
    apps: ShieldApp[],
    meta?: { title?: string; subject?: string; armedBy?: string }
  ) {
    const blocked = apps.filter((a) => a.blocked).map((a) => a.packageId);
    // Every app the teacher left unblocked is an allowed study app.
    const allowed = apps.filter((a) => !a.blocked).map((a) => a.packageId);
    const whitelist = Array.from(new Set([...essentialWhitelist, ...allowed]));
    if (LINKED?.activate) {
      return LINKED.activate({
        sessionId,
        endsAt,
        blockedPackages: blocked,
        whitelistPackages: whitelist,
        title: meta?.title,
        subject: meta?.subject,
        token: getToken() || undefined,
        apiBase: getApiBase() || undefined,
        armedBy: meta?.armedBy,
      });
    }
    return false;
  },

  async updateShield(apps: ShieldApp[]) {
    const blocked = apps.filter((a) => a.blocked).map((a) => a.packageId);
    const allowed = apps.filter((a) => !a.blocked).map((a) => a.packageId);
    const whitelist = Array.from(new Set([...essentialWhitelist, ...allowed]));
    if (LINKED?.updateShield) {
      return LINKED.updateShield({ blockedPackages: blocked, whitelistPackages: whitelist });
    }
    return false;
  },

  async deactivate() {
    if (LINKED?.deactivate) return LINKED.deactivate();
    return false;
  },

  async isEnforcing() {
    if (LINKED?.isEnforcing) return LINKED.isEnforcing();
    return false;
  },

  /**
   * Every launchable app on this device (via a MAIN/LAUNCHER <queries>
   * declaration — no restricted permission). Used by the Shield tab's
   * "detect apps on this phone" scan. Empty outside the real Android build.
   */
  async getInstalledApps(): Promise<InstalledApp[]> {
    if (LINKED?.getInstalledApps) {
      const apps = await LINKED.getInstalledApps().catch(() => [] as InstalledApp[]);
      return Array.isArray(apps) ? apps : [];
    }
    return [];
  },

  /** Subscribe to native enforcement events. Returns an unsubscribe fn. */
  subscribe(handler: (evt: NativeLockdownEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener('bt.lockdown.event', handler as (e: unknown) => void);
    return () => sub.remove();
  },
};
