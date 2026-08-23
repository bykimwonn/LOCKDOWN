import { NativeModules, Platform } from 'react-native';
import type { PermissionStatus, ShieldApp } from '@/src/types';

type NativeLockdown = {
  requestScreenTimeAuthorization: () => Promise<boolean>;
  requestAccessibility: () => Promise<boolean>;
  requestOverlay: () => Promise<boolean>;
  getPermissionStatus: () => Promise<PermissionStatus>;
  activate: (payload: {
    sessionId: string;
    endsAt: string;
    blockedPackages: string[];
    whitelistPackages: string[];
  }) => Promise<boolean>;
  deactivate: () => Promise<boolean>;
  isEnforcing: () => Promise<boolean>;
};

const LINKED: Partial<NativeLockdown> | undefined = NativeModules.BTLockdownModule;

const fallbackPerms = (): PermissionStatus => ({
  screenTime: Platform.OS === 'ios' ? 'pending' : 'unavailable',
  accessibility: Platform.OS === 'android' ? 'pending' : 'unavailable',
  overlay: Platform.OS === 'android' ? 'pending' : 'unavailable',
  notifications: 'pending',
});

/**
 * Thin JS bridge. On a real device after `expo prebuild` this talks to
 * FamilyControls (iOS) and the Accessibility Service (Android).
 * In Expo Go / web it simulates enforcement so the product can be demoed.
 */
export const LockdownNative = {
  available: Boolean(LINKED?.activate),

  async requestScreenTimeAuthorization() {
    if (LINKED?.requestScreenTimeAuthorization) {
      return LINKED.requestScreenTimeAuthorization();
    }
    return true;
  },

  async requestAccessibility() {
    if (LINKED?.requestAccessibility) return LINKED.requestAccessibility();
    return true;
  },

  async requestOverlay() {
    if (LINKED?.requestOverlay) return LINKED.requestOverlay();
    return true;
  },

  async getPermissionStatus(): Promise<PermissionStatus> {
    if (LINKED?.getPermissionStatus) return LINKED.getPermissionStatus();
    return fallbackPerms();
  },

  async activate(sessionId: string, endsAt: string, apps: ShieldApp[]) {
    const blocked = apps.filter((a) => a.blocked).map((a) => a.packageId);
    const whitelist = [
      'com.btsoftware.lockdown',
      'com.btsoftware.learning',
      'com.apple.mobilephone',
      'com.apple.MobileSMS',
      'com.android.dialer',
      'com.google.android.apps.messaging',
    ];
    if (LINKED?.activate) {
      return LINKED.activate({ sessionId, endsAt, blockedPackages: blocked, whitelistPackages: whitelist });
    }
    return true;
  },

  async deactivate() {
    if (LINKED?.deactivate) return LINKED.deactivate();
    return true;
  },

  async isEnforcing() {
    if (LINKED?.isEnforcing) return LINKED.isEnforcing();
    return false;
  },
};
