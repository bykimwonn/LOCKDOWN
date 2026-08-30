import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { getApiBase, getToken } from '@/src/config';
import type { PermissionStatus, ShieldApp } from '@/src/types';

type NativeLockdown = {
  requestScreenTimeAuthorization: () => Promise<boolean>;
  requestAccessibility: () => Promise<boolean>;
  requestOverlay: () => Promise<boolean>;
  requestBatteryExemption: () => Promise<boolean>;
  requestDeviceAdmin: () => Promise<boolean>;
  openAutostartSettings: () => Promise<boolean>;
  startBackgroundGuard: () => Promise<boolean>;
  showCornerTimer: (targetAt: number) => Promise<boolean>;
  hideCornerTimer: () => Promise<boolean>;
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
};

export type DeviceGuard = {
  accessibility: 'granted' | 'denied' | 'unavailable';
  overlay: 'granted' | 'denied' | 'unavailable';
  battery: 'granted' | 'denied' | 'unavailable';
  admin: 'granted' | 'denied' | 'unavailable';
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
    | 'adminDisabled'
    | 'overlayDenied'
    | 'heartbeatLost';
  app?: string;
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

  /** Subscribe to native enforcement events. Returns an unsubscribe fn. */
  subscribe(handler: (evt: NativeLockdownEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener('bt.lockdown.event', handler as (e: unknown) => void);
    return () => sub.remove();
  },
};
