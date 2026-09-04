export type PlatformKind = 'ios' | 'android' | 'web';

export type SessionStatus =
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'failed'
  | 'abandoned';

export type SessionSource = 'timetable' | 'manual';

export type ViolationType =
  | 'force_quit'
  | 'permission_revoked'
  | 'blocked_app'
  | 'time_tamper'
  | 'emergency_unlock'
  | 'accessibility_off'
  | 'admin_disabled'
  | 'network_shield_off'
  | 'heartbeat_miss';

export type AppCategory = 'social' | 'games' | 'entertainment' | 'browsers' | 'other';

export interface DeviceBinding {
  device_id?: string;
  platform?: string;
  registered_at?: string;
  last_heartbeat?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  studentId?: string;
  handle: string;
  role?: string;
  elo: number;
  streak: number;
  longestStreak: number;
  sessionsCompleted: number;
  minutesLocked: number;
  device?: DeviceBinding;
}

export interface DeepWorkSession {
  id: string;
  title: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  status: SessionStatus;
  source: SessionSource;
  focusNote?: string;
}

export interface LockdownState {
  active: boolean;
  sessionId?: string;
  serverStartedAt?: string;
  serverEndsAt?: string;
  lastHeartbeatAt?: string;
  armedBy: 'sync' | 'manual' | 'none';
}

export interface Violation {
  id: string;
  type: ViolationType;
  at: string;
  sessionId?: string;
  eloDelta: number;
  streakBroken: boolean;
  detail: string;
}

export interface ShieldApp {
  id: string;
  name: string;
  packageId: string;
  category: AppCategory;
  blocked: boolean;
  iconHint: string;
}

export interface WhitelistApp {
  id: string;
  name: string;
  reason: string;
  essential: boolean;
}

export interface SyncFlag {
  userId: string;
  lockdownActive: boolean;
  sessionId?: string;
  serverNow: string;
  startsAt?: string;
  endsAt?: string;
  revision: number;
}

export interface PermissionStatus {
  screenTime: 'granted' | 'denied' | 'unavailable' | 'pending';
  accessibility: 'granted' | 'denied' | 'unavailable' | 'pending';
  overlay: 'granted' | 'denied' | 'unavailable' | 'pending';
  notifications: 'granted' | 'denied' | 'pending';
}

export type RouteGate = 'splash' | 'onboarding' | 'auth' | 'permissions' | 'app';
