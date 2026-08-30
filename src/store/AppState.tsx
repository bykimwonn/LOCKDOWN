import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { AppState as RNAppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SHIELD_APPS } from '@/src/data/seed';
import { getApiBase, hydrateConfig, setToken } from '@/src/config';
import {
  completeSession,
  createManualSession,
  fetchMe,
  loginToLearning,
  logoutRemote,
  logoutDevice,
  pullSync,
  pushHeartbeat,
  reportViolation,
  retryComplete,
  retryEvent,
} from '@/src/services/api';
import { clearOutbox, drainOutbox, initOutbox, setOutboxRunner } from '@/src/services/outbox';
import { penaltyFor } from '@/src/services/penalties';
import { ensureNotificationPermission, scheduleSessionStarts } from '@/src/services/notifications';
import {
  LockdownNative,
  type NativeLockdownEvent,
} from '@/src/services/lockdownNative';
import { clockSkewMs, serverNow, serverNowIso } from '@/src/services/serverTime';
import type {
  DeepWorkSession,
  LockdownState,
  PermissionStatus,
  RouteGate,
  ShieldApp,
  UserProfile,
  Violation,
  ViolationType,
} from '@/src/types';

const STORAGE_KEY = 'bt.lockdown.v2';
const CLOCK_TAMPER_MS = 120_000; // matches the server's drift threshold
const TAMPER_THROTTLE_MS = 10 * 60_000;

type State = {
  hydrated: boolean;
  gate: RouteGate;
  user: UserProfile | null;
  sessions: DeepWorkSession[];
  lockdown: LockdownState;
  violations: Violation[];
  shield: ShieldApp[];
  permissions: PermissionStatus;
  syncOk: boolean;
  lastSyncAt?: string;
  missedHeartbeats: number;
  apiBase: string;
  enforcementAvailable: boolean;
};

type Action =
  | { type: 'HYDRATE'; payload: Partial<State> }
  | { type: 'SET_GATE'; gate: RouteGate }
  | { type: 'SIGN_IN'; user: UserProfile }
  | { type: 'SET_USER'; user: UserProfile }
  | { type: 'SIGN_OUT' }
  | { type: 'SET_PERMISSIONS'; permissions: PermissionStatus }
  | { type: 'SET_SESSIONS'; sessions: DeepWorkSession[] }
  | { type: 'PATCH_SESSION'; id: string; patch: Partial<DeepWorkSession> }
  | { type: 'SET_LOCKDOWN'; lockdown: LockdownState }
  | { type: 'ADD_VIOLATION'; violation: Violation }
  | { type: 'SET_VIOLATIONS'; violations: Violation[] }
  | { type: 'SET_SHIELD'; shield: ShieldApp[] }
  | { type: 'TOGGLE_APP'; id: string }
  | { type: 'SET_SYNC'; ok: boolean; at: string }
  | { type: 'APPLY_PENALTY'; eloDelta: number; breakStreak: boolean }
  | { type: 'COMPLETE_SESSION'; id: string; minutes: number }
  | { type: 'HEARTBEAT'; at: string; missed?: boolean }
  | { type: 'SET_API'; apiBase: string }
  | { type: 'SET_ENFORCEMENT'; available: boolean };

const defaultPerms = (): PermissionStatus => ({
  screenTime: 'unavailable',
  accessibility: Platform.OS === 'android' ? 'pending' : 'unavailable',
  overlay: Platform.OS === 'android' ? 'pending' : 'unavailable',
  notifications: 'pending',
});

const initial: State = {
  hydrated: false,
  gate: 'splash',
  user: null,
  sessions: [],
  lockdown: { active: false, armedBy: 'none' },
  violations: [],
  shield: SHIELD_APPS,
  permissions: defaultPerms(),
  syncOk: false,
  missedHeartbeats: 0,
  apiBase: '',
  enforcementAvailable: Platform.OS === 'android',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, hydrated: true };
    case 'SET_GATE':
      return { ...state, gate: action.gate };
    case 'SIGN_IN':
      return { ...state, user: action.user, gate: 'permissions' };
    case 'SET_USER':
      return { ...state, user: action.user };
    case 'SIGN_OUT':
      return {
        ...initial,
        hydrated: true,
        gate: 'auth',
        shield: state.shield,
        apiBase: state.apiBase,
        enforcementAvailable: state.enforcementAvailable,
      };
    case 'SET_PERMISSIONS':
      return { ...state, permissions: action.permissions };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions };
    case 'PATCH_SESSION':
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      };
    case 'SET_LOCKDOWN':
      return { ...state, lockdown: action.lockdown };
    case 'ADD_VIOLATION':
      return { ...state, violations: [action.violation, ...state.violations] };
    case 'SET_VIOLATIONS':
      return { ...state, violations: action.violations };
    case 'SET_SHIELD':
      return { ...state, shield: action.shield };
    case 'TOGGLE_APP':
      return {
        ...state,
        shield: state.shield.map((a) => (a.id === action.id ? { ...a, blocked: !a.blocked } : a)),
      };
    case 'SET_SYNC':
      return { ...state, syncOk: action.ok, lastSyncAt: action.at };
    case 'APPLY_PENALTY': {
      if (!state.user) return state;
      const elo = Math.max(800, state.user.elo + action.eloDelta);
      const streak = action.breakStreak ? 0 : state.user.streak;
      return { ...state, user: { ...state.user, elo, streak } };
    }
    case 'COMPLETE_SESSION': {
      if (!state.user) return state;
      return {
        ...state,
        user: {
          ...state.user,
          sessionsCompleted: state.user.sessionsCompleted + 1,
          minutesLocked: state.user.minutesLocked + action.minutes,
        },
        sessions: state.sessions.map((s) =>
          s.id === action.id ? { ...s, status: 'completed' } : s
        ),
      };
    }
    case 'HEARTBEAT':
      return {
        ...state,
        lockdown: { ...state.lockdown, lastHeartbeatAt: action.at },
        missedHeartbeats: action.missed ? state.missedHeartbeats + 1 : 0,
      };
    case 'SET_API':
      return { ...state, apiBase: action.apiBase };
    case 'SET_ENFORCEMENT':
      return { ...state, enforcementAvailable: action.available };
    default:
      return state;
  }
}

type Ctx = State & {
  login: (id: string, password: string) => Promise<void>;
  signOut: () => void;
  finishOnboarding: () => void;
  refreshPermissionStatus: () => Promise<void>;
  finishPermissions: () => Promise<void>;
  requestBatteryExemption: () => Promise<void>;
  startManualFocus: (minutes: number, title?: string) => Promise<void>;
  emergencyUnlock: () => Promise<void>;
  toggleApp: (id: string) => void;
  recordAttempt: (appLabel: string) => void;
  setGate: (gate: RouteGate) => void;
};

const Context = createContext<Ctx | null>(null);

function makeViolation(
  type: ViolationType,
  detail: string,
  sessionId: string | undefined,
  eloDelta: number,
  streakBroken: boolean
): Violation {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    at: serverNowIso(),
    sessionId,
    eloDelta,
    streakBroken,
    detail,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const backgroundedAt = useRef<number | null>(null);
  const lastTamperAt = useRef(0);
  const blockCounts = useRef<Map<string, number>>(new Map());
  const sessionEvents = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      await hydrateConfig();
      await initOutbox();
      setOutboxRunner(async (label, payload) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        if (label === 'event') await retryEvent(p);
        else await retryComplete(p);
      });
      dispatch({ type: 'SET_API', apiBase: getApiBase() });
      dispatch({
        type: 'SET_ENFORCEMENT',
        available: Platform.OS === 'android' ? LockdownNative.available : false,
      });
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = raw ? (JSON.parse(raw) as Partial<State>) : {};
        try {
          const me = await fetchMe();
          dispatch({
            type: 'HYDRATE',
            payload: {
              user: me.user,
              violations: me.violations,
              gate: saved.permissions ? 'app' : 'permissions',
              shield: saved.shield ?? SHIELD_APPS,
              permissions: saved.permissions ?? defaultPerms(),
              sessions: [],
              lockdown: { active: false, armedBy: 'none' },
              apiBase: getApiBase(),
            },
          });
          return;
        } catch {
          setToken('');
        }
        dispatch({
          type: 'HYDRATE',
          payload: {
            user: null,
            gate: saved.gate === 'onboarding' || !saved.gate ? 'onboarding' : 'auth',
            shield: saved.shield ?? SHIELD_APPS,
            permissions: saved.permissions ?? defaultPerms(),
            violations: [],
            sessions: [],
            apiBase: getApiBase(),
          },
        });
      } catch {
        dispatch({ type: 'HYDRATE', payload: { gate: 'onboarding', apiBase: getApiBase() } });
      }
    })();
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        gate: state.gate,
        shield: state.shield,
        permissions: state.permissions,
      })
    ).catch(() => undefined);
  }, [state.hydrated, state.gate, state.shield, state.permissions]);

  /**
   * Local penalty preview. Numbers mirror the server so the UI tells the
   * truth (BT LEARNING applies the real penalty on its side):
   *  - blocked app: 1st = warning, 2nd = -10, 3rd+ = -25 + streak
   *  - force quit / emergency unlock: -25 + streak
   *  - permission revoked / clock tamper: -50 + streak
   *  - heartbeat loss: local only, never scored
   */
  const punish = useCallback(async (type: ViolationType, detail: string) => {
    const s = stateRef.current;

    // Count blocked-app attempts per session; other types are flat penalties.
    let blockCount = 1;
    if (type === 'blocked_app') {
      const key = s.lockdown.sessionId || 'unknown';
      blockCount = (blockCounts.current.get(key) || 0) + 1;
      blockCounts.current.set(key, blockCount);
    }

    const { eloDelta, breakStreak, scored } = penaltyFor(type, blockCount);

    if (s.lockdown.sessionId && scored) {
      const n = (sessionEvents.current.get(s.lockdown.sessionId) || 0) + 1;
      sessionEvents.current.set(s.lockdown.sessionId, n);
    }

    const v = makeViolation(type, detail, s.lockdown.sessionId, eloDelta, breakStreak);
    dispatch({ type: 'ADD_VIOLATION', violation: v });
    if (eloDelta !== 0 || breakStreak) dispatch({ type: 'APPLY_PENALTY', eloDelta, breakStreak });
    const updated = await reportViolation({
      type,
      sessionId: s.lockdown.sessionId,
      detail,
      eloDelta,
      streakBroken: breakStreak,
    });
    if (updated) dispatch({ type: 'SET_USER', user: updated });
  }, []);

  const arm = useCallback(
    async (session: DeepWorkSession, armedBy: 'sync' | 'manual') => {
      await LockdownNative.activate(session.id, session.endsAt, stateRef.current.shield, {
        title: session.title,
        subject: session.subject,
        armedBy,
      });
      blockCounts.current.set(session.id, 0);
      sessionEvents.current.set(session.id, 0);
      dispatch({
        type: 'SET_LOCKDOWN',
        lockdown: {
          active: true,
          sessionId: session.id,
          serverStartedAt: session.startsAt ?? serverNowIso(),
          serverEndsAt: session.endsAt,
          lastHeartbeatAt: serverNowIso(),
          armedBy,
        },
      });
      dispatch({ type: 'PATCH_SESSION', id: session.id, patch: { status: 'active' } });
    },
    []
  );

  const disarm = useCallback(async (outcome: 'completed' | 'abandoned' | 'failed') => {
    const s = stateRef.current;
    await LockdownNative.deactivate();
    if (s.lockdown.sessionId) {
      if (outcome === 'completed' && s.lockdown.serverStartedAt && s.lockdown.serverEndsAt) {
        const minutes = Math.max(
          1,
          Math.round(
            (Date.parse(s.lockdown.serverEndsAt) - Date.parse(s.lockdown.serverStartedAt)) / 60000
          )
        );
        const violations = sessionEvents.current.get(s.lockdown.sessionId) || 0;
        dispatch({ type: 'COMPLETE_SESSION', id: s.lockdown.sessionId, minutes });
        const session = s.sessions.find((x) => x.id === s.lockdown.sessionId);
        const updated = await completeSession(s.lockdown.sessionId, violations, session?.subject);
        if (updated) dispatch({ type: 'SET_USER', user: updated });
      } else {
        dispatch({ type: 'PATCH_SESSION', id: s.lockdown.sessionId, patch: { status: outcome } });
      }
    }
    dispatch({ type: 'SET_LOCKDOWN', lockdown: { active: false, armedBy: 'none' } });
  }, []);

  // ------------------------------------------------------------------
  // Sync loop: one round-trip to BT LEARNING. 4s when the server is
  // healthy, backing off to 8/15/30s (+jitter) on repeated failures so a
  // cold-starting Render free tier (and the battery) aren't hammered.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!state.user || state.gate !== 'app') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const backoffMs = () => {
      const base = failures >= 4 ? 30_000 : failures >= 2 ? 15_000 : failures === 1 ? 8_000 : 4_000;
      const jitter = Math.floor(Math.random() * 1500);
      return base + jitter;
    };

    const tick = async () => {
      const s = stateRef.current;
      try {
        const result = await pullSync();
        if (!alive) return;
        failures = 0;
        dispatch({ type: 'SET_SESSIONS', sessions: result.sessions });
        dispatch({ type: 'SET_SYNC', ok: true, at: result.serverNow });
        if (result.user) dispatch({ type: 'SET_USER', user: result.user });
        scheduleSessionStarts(result.sessions);
        drainOutbox().catch(() => undefined);

        // Clock tamper — throttled, matches the server's 120s threshold
        if (clockSkewMs() > CLOCK_TAMPER_MS && Date.now() - lastTamperAt.current > TAMPER_THROTTLE_MS) {
          lastTamperAt.current = Date.now();
          punish('time_tamper', 'Local clock drifted more than 2 minutes from server time.');
        }

        if (result.lockdownActive && result.sessionId && !s.lockdown.active) {
          const session =
            result.sessions.find((x) => x.id === result.sessionId) ??
            ({
              id: result.sessionId,
              title: result.title || 'Deep Work',
              subject: result.subject || 'Study',
              startsAt: result.startsAt ?? serverNowIso(),
              endsAt: result.endsAt ?? new Date(Date.now() + 50 * 60000).toISOString(),
              status: 'active',
              source: 'timetable',
            } as DeepWorkSession);
          await arm(session, 'sync');
        }

        if (s.lockdown.active && s.lockdown.serverEndsAt) {
          if (serverNow().getTime() >= Date.parse(s.lockdown.serverEndsAt)) {
            await disarm('completed');
          } else if (s.lockdown.sessionId && !LockdownNative.available) {
            // JS heartbeat only when the native watchdog is not running
            const sess = s.sessions.find((x) => x.id === s.lockdown.sessionId);
            const beat = await pushHeartbeat(s.lockdown.sessionId, sess?.subject);
            dispatch({ type: 'HEARTBEAT', at: serverNowIso(), missed: !beat.ok });
          }
        }

        if (s.lockdown.active && !result.lockdownActive && s.lockdown.armedBy === 'sync') {
          await disarm('completed');
        }
      } catch {
        failures += 1;
        dispatch({ type: 'SET_SYNC', ok: false, at: serverNowIso() });
      }
      if (alive) timer = setTimeout(tick, backoffMs());
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [state.user, state.gate, arm, disarm, punish]);

  // ------------------------------------------------------------------
  // Native enforcement events (watchdog + accessibility service)
  // ------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = LockdownNative.subscribe((evt: NativeLockdownEvent) => {
      const s = stateRef.current;
      switch (evt.event) {
        case 'expired':
          if (s.lockdown.active) void disarm('completed');
          break;
        case 'serverInactive':
          if (s.lockdown.active && s.lockdown.armedBy === 'sync') void disarm('completed');
          break;
        case 'unauthorized':
          if (s.user) void signOutRef.current?.();
          break;
        case 'accessibilityOff':
          if (s.lockdown.active) {
            void punish(
              'accessibility_off',
              'The lockdown service was disabled on the device mid-session.'
            );
          }
          break;
        case 'adminDisabled':
          if (s.lockdown.active) {
            void punish(
              'admin_disabled',
              'Device admin was removed during a sealed session — treated as tamper.'
            );
          }
          break;
        case 'blocked': {
          const known = stateRef.current.shield.find((a) => a.packageId === evt.app);
          void recordAttemptRef.current?.(known ? known.name : (evt.app || 'unknown app'));
          break;
        }
        case 'heartbeatLost':
          dispatch({ type: 'HEARTBEAT', at: serverNowIso(), missed: true });
          break;
        case 'overlayDenied':
          break;
        default:
          break;
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arm, disarm, punish]);

  // Force-quit detection: the React process leaving the foreground for a
  // long stretch during a sealed session.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      const s = stateRef.current;
      if (!s.lockdown.active) return;
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now();
      }
      if (next === 'active' && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > 12_000) {
          void punish(
            'force_quit',
            `Process left the foreground for ${Math.round(away / 1000)}s during Deep Work. Treated as tamper.`
          );
        }
      }
    });
    return () => sub.remove();
  }, [punish]);

  const login = useCallback(async (id: string, password: string) => {
    const { user } = await loginToLearning(id, password);
    dispatch({ type: 'SET_API', apiBase: getApiBase() });
    dispatch({ type: 'SIGN_IN', user });
  }, []);

  const signOut = useCallback(() => {
    LockdownNative.deactivate();
    void logoutDevice();
    clearOutbox();
    logoutRemote();
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  const signOutRef = useRef<(() => void) | null>(null);
  signOutRef.current = signOut;

  const finishOnboarding = useCallback(() => dispatch({ type: 'SET_GATE', gate: 'auth' }), []);

  /** Re-read the real permission state without opening any system dialog. */
  const refreshPermissionStatus = useCallback(async () => {
    if (Platform.OS !== 'android') {
      dispatch({
        type: 'SET_PERMISSIONS',
        permissions: {
          screenTime: 'unavailable',
          accessibility: 'unavailable',
          overlay: 'unavailable',
          notifications: 'pending',
        },
      });
      return;
    }
    const guard = await LockdownNative.getDeviceGuard().catch(() => null);
    let notifications: 'granted' | 'denied' | 'pending' = 'pending';
    try {
      const p = await Notifications.getPermissionsAsync();
      notifications = p.granted ? 'granted' : p.granted === false ? 'denied' : 'pending';
    } catch {
      /* keep pending */
    }
    dispatch({
      type: 'SET_PERMISSIONS',
      permissions: {
        screenTime: 'unavailable',
        accessibility: (guard?.accessibility as 'granted' | 'denied') || 'denied',
        overlay: (guard?.overlay as 'granted' | 'denied') || 'denied',
        notifications,
      },
    });
  }, []);

  const finishPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      // iOS enforcement build is not wired yet — be honest about it.
      dispatch({
        type: 'SET_PERMISSIONS',
        permissions: {
          screenTime: 'unavailable',
          accessibility: 'unavailable',
          overlay: 'unavailable',
          notifications: 'pending',
        },
      });
      dispatch({ type: 'SET_ENFORCEMENT', available: false });
      dispatch({ type: 'SET_GATE', gate: 'app' });
      return;
    }

    // Open the system dialogs ONE AT A TIME and wait for the student to
    // actually grant each before moving on. Firing all five at once makes
    // Android show only one (or none) — which is exactly why the Device
    // Admin / phone-admin prompt was never seen and the Accessibility
    // service was left off, so the barrier never appeared. Reading
    // getDeviceGuard() immediately also recorded "denied" before the
    // student had a chance to toggle anything.
    const guardValue = () =>
      LockdownNative.getDeviceGuard().catch(() => null).then((g) => g ?? null);
    const waitFor = async (
      check: (g: Awaited<ReturnType<typeof guardValue>>) => boolean,
      timeoutMs = 90_000
    ): Promise<boolean> => {
      const start = Date.now();
      return new Promise((resolve) => {
        const poll = async () => {
          const g = await guardValue();
          if (check(g)) return resolve(true);
          if (Date.now() - start > timeoutMs) return resolve(false);
          setTimeout(poll, 1200);
        };
        poll();
      });
    };

    // 1. Accessibility service — THE gate that makes blocking actually work.
    try {
      await LockdownNative.requestAccessibility();
      await waitFor((g) => g?.accessibility === 'granted');
    } catch { /* leave off; user can retry from the System tab */ }

    // 2. Overlay permission — needed for the full-screen sealed barrier.
    try {
      await LockdownNative.requestOverlay();
      await waitFor((g) => g?.overlay === 'granted');
    } catch { /* leave off */ }

    // 3. Notifications (session alerts).
    await ensureNotificationPermission().catch(() => false);

    // 4. Battery exemption (keeps the watchdog alive on Redmi/MIUI).
    try {
      await LockdownNative.requestBatteryExemption();
    } catch { /* non-fatal */ }

    // 5. Device-admin tripwire — now requested AFTER the others and given
    //    its own wait, so the "Add device admin" screen actually appears.
    try {
      await LockdownNative.requestDeviceAdmin();
      await waitFor((g) => g?.admin === 'granted');
    } catch { /* best-effort */ }

    const guard = await guardValue();
    if (guard?.miui === 'detected') {
      await LockdownNative.openAutostartSettings().catch(() => false);
    }
    // Re-read the real state (the student may have toggled and come back).
    await refreshPermissionStatus();
    dispatch({ type: 'SET_ENFORCEMENT', available: LockdownNative.available });
    dispatch({ type: 'SET_GATE', gate: 'app' });
  }, [refreshPermissionStatus]);

  const requestBatteryExemption = useCallback(async () => {
    await LockdownNative.requestBatteryExemption().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 800));
    await refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  const startManualFocus = useCallback(
    async (minutes: number, title = 'Manual Deep Work') => {
      const start = serverNow();
      let id = `ses_man_${start.getTime()}`;
      let endsAt = new Date(start.getTime() + minutes * 60000).toISOString();
      let startsAt = start.toISOString();
      try {
        const created = await createManualSession(minutes, 'Focus');
        id = String(created.session_id);
        startsAt = created.start_time.includes('T') ? created.start_time : created.start_time.replace(' ', 'T');
        endsAt = created.end_time.includes('T') ? created.end_time : created.end_time.replace(' ', 'T');
        if (!startsAt.endsWith('Z') && !startsAt.includes('+')) startsAt += 'Z';
        if (!endsAt.endsWith('Z') && !endsAt.includes('+')) endsAt += 'Z';
      } catch {
        /* still arm locally if the create call fails */
      }
      const session: DeepWorkSession = {
        id,
        title,
        subject: 'Focus',
        startsAt,
        endsAt,
        status: 'active',
        source: 'manual',
        focusNote: 'Armed from BT LOCKDOWN',
      };
      dispatch({ type: 'SET_SESSIONS', sessions: [session, ...stateRef.current.sessions] });
      await arm(session, 'manual');
    },
    [arm]
  );

  const emergencyUnlock = useCallback(async () => {
    await punish('emergency_unlock', 'Student invoked emergency unlock. Session voided.');
    await disarm('abandoned');
  }, [disarm, punish]);

  const toggleApp = useCallback((id: string) => {
    // Tier 1 #3: the shield is frozen while a session is sealed — a student
    // could otherwise switch WhatsApp off from the Shield tab and walk
    // straight through the barrier. Changes apply from the next session.
    // The native side rejects updateShield while active too (defense in
    // depth).
    if (stateRef.current.lockdown.active) return;
    dispatch({ type: 'TOGGLE_APP', id });
    // Live-update the native shield list.
    const next = stateRef.current.shield.map((a) => (a.id === id ? { ...a, blocked: !a.blocked } : a));
    void LockdownNative.updateShield(next).catch(() => undefined);
  }, []);

  const recordAttempt = useCallback(
    (appLabel: string) => {
      void punish('blocked_app', `Intercepted launch of ${appLabel} during a sealed session.`);
    },
    [punish]
  );

  const recordAttemptRef = useRef<((app: string) => void) | null>(null);
  recordAttemptRef.current = recordAttempt;

  const setGate = useCallback((gate: RouteGate) => dispatch({ type: 'SET_GATE', gate }), []);

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      login,
      signOut,
      finishOnboarding,
      refreshPermissionStatus,
      finishPermissions,
      requestBatteryExemption,
      startManualFocus,
      emergencyUnlock,
      toggleApp,
      recordAttempt,
      setGate,
    }),
    [
      state,
      login,
      signOut,
      finishOnboarding,
      refreshPermissionStatus,
      finishPermissions,
      requestBatteryExemption,
      startManualFocus,
      emergencyUnlock,
      toggleApp,
      recordAttempt,
      setGate,
    ]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
