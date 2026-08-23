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
import { SHIELD_APPS } from '@/src/data/seed';
import { getApiBase, hydrateConfig, setToken } from '@/src/config';
import {
  completeSession,
  createManualSession,
  fetchMe,
  fetchTimetable,
  loginToLearning,
  logoutRemote,
  pullSyncFlag,
  pushHeartbeat,
  reportViolation,
} from '@/src/services/api';
import { LockdownNative } from '@/src/services/lockdownNative';
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
  | { type: 'SET_API'; apiBase: string };

const defaultPerms = (): PermissionStatus => ({
  screenTime: Platform.OS === 'ios' ? 'pending' : 'unavailable',
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
    default:
      return state;
  }
}

type Ctx = State & {
  login: (id: string, password: string) => Promise<void>;
  signOut: () => void;
  finishOnboarding: () => void;
  finishPermissions: () => Promise<void>;
  startManualFocus: (minutes: number, title?: string) => Promise<void>;
  emergencyUnlock: () => Promise<void>;
  toggleApp: (id: string) => void;
  recordAttempt: (appName: string) => void;
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

  useEffect(() => {
    (async () => {
      await hydrateConfig();
      dispatch({ type: 'SET_API', apiBase: getApiBase() });
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

  const punish = useCallback(
    async (type: ViolationType, detail: string, eloDelta: number, breakStreak: boolean) => {
      const s = stateRef.current;
      const v = makeViolation(type, detail, s.lockdown.sessionId, eloDelta, breakStreak);
      dispatch({ type: 'ADD_VIOLATION', violation: v });
      dispatch({ type: 'APPLY_PENALTY', eloDelta, breakStreak });
      const updated = await reportViolation({
        type,
        sessionId: s.lockdown.sessionId,
        detail,
        eloDelta,
        streakBroken: breakStreak,
      });
      if (updated) dispatch({ type: 'SET_USER', user: updated });
    },
    []
  );

  const arm = useCallback(async (session: DeepWorkSession, armedBy: 'sync' | 'manual') => {
    await LockdownNative.activate(session.id, session.endsAt, stateRef.current.shield);
    dispatch({
      type: 'SET_LOCKDOWN',
      lockdown: {
        active: true,
        sessionId: session.id,
        serverStartedAt: serverNowIso(),
        serverEndsAt: session.endsAt,
        lastHeartbeatAt: serverNowIso(),
        armedBy,
      },
    });
    dispatch({ type: 'PATCH_SESSION', id: session.id, patch: { status: 'active' } });
  }, []);

  const disarm = useCallback(async (outcome: 'completed' | 'abandoned' | 'failed') => {
    const s = stateRef.current;
    await LockdownNative.deactivate();
    if (s.lockdown.sessionId) {
      if (outcome === 'completed' && s.lockdown.serverStartedAt && s.lockdown.serverEndsAt) {
        const minutes = Math.max(
          1,
          Math.round((Date.parse(s.lockdown.serverEndsAt) - Date.parse(s.lockdown.serverStartedAt)) / 60000)
        );
        dispatch({ type: 'COMPLETE_SESSION', id: s.lockdown.sessionId, minutes });
        const session = s.sessions.find((x) => x.id === s.lockdown.sessionId);
        const updated = await completeSession(s.lockdown.sessionId, minutes, session?.subject);
        if (updated) dispatch({ type: 'SET_USER', user: updated });
      } else {
        dispatch({ type: 'PATCH_SESSION', id: s.lockdown.sessionId, patch: { status: outcome } });
      }
    }
    dispatch({ type: 'SET_LOCKDOWN', lockdown: { active: false, armedBy: 'none' } });
  }, []);

  useEffect(() => {
    if (!state.user || state.gate !== 'app') return;
    let alive = true;
    const tick = async () => {
      const s = stateRef.current;
      try {
        const [flag, sessions] = await Promise.all([pullSyncFlag(), fetchTimetable()]);
        if (!alive) return;
        dispatch({ type: 'SET_SESSIONS', sessions });
        dispatch({ type: 'SET_SYNC', ok: true, at: flag.serverNow });
        if (flag.user) dispatch({ type: 'SET_USER', user: flag.user });

        if (clockSkewMs() > 90_000 && s.lockdown.active) {
          punish('time_tamper', 'Local clock drifted more than 90s from server time.', -20, false);
        }

        if (flag.lockdownActive && flag.sessionId && !s.lockdown.active) {
          const session =
            sessions.find((x) => x.id === flag.sessionId) ??
            ({
              id: flag.sessionId,
              title: flag.title || 'Deep Work',
              subject: flag.subject || 'Study',
              startsAt: flag.startsAt ?? serverNowIso(),
              endsAt: flag.endsAt ?? new Date(Date.now() + 50 * 60000).toISOString(),
              status: 'active',
              source: 'timetable',
            } as DeepWorkSession);
          await arm(session, 'sync');
        }

        if (s.lockdown.active && s.lockdown.serverEndsAt) {
          if (serverNow().getTime() >= Date.parse(s.lockdown.serverEndsAt)) {
            await disarm('completed');
          } else if (s.lockdown.sessionId) {
            const sess = s.sessions.find((x) => x.id === s.lockdown.sessionId);
            const beat = await pushHeartbeat(s.lockdown.sessionId, sess?.subject);
            dispatch({ type: 'HEARTBEAT', at: serverNowIso(), missed: !beat.ok });
            if (!beat.ok && s.missedHeartbeats >= 4) {
              punish('heartbeat_miss', 'Lost contact with BT LEARNING during a sealed session.', -12, false);
            }
          }
        }

        if (s.lockdown.active && !flag.lockdownActive && s.lockdown.armedBy === 'sync') {
          await disarm('completed');
        }
      } catch {
        dispatch({ type: 'SET_SYNC', ok: false, at: serverNowIso() });
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state.user, state.gate, arm, disarm, punish]);

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
          punish(
            'force_quit',
            `Process left the foreground for ${Math.round(away / 1000)}s during Deep Work. Treated as tamper.`,
            -35,
            true
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
    logoutRemote();
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  const finishOnboarding = useCallback(() => dispatch({ type: 'SET_GATE', gate: 'auth' }), []);

  const finishPermissions = useCallback(async () => {
    if (Platform.OS === 'ios') await LockdownNative.requestScreenTimeAuthorization();
    if (Platform.OS === 'android') {
      await LockdownNative.requestAccessibility();
      await LockdownNative.requestOverlay();
    }
    dispatch({
      type: 'SET_PERMISSIONS',
      permissions: {
        screenTime: Platform.OS === 'ios' ? 'granted' : 'unavailable',
        accessibility: Platform.OS === 'android' ? 'granted' : 'unavailable',
        overlay: Platform.OS === 'android' ? 'granted' : 'unavailable',
        notifications: 'granted',
      },
    });
    dispatch({ type: 'SET_GATE', gate: 'app' });
  }, []);

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
    await punish('emergency_unlock', 'Student invoked emergency unlock. Session voided.', -40, true);
    await disarm('abandoned');
  }, [disarm, punish]);

  const toggleApp = useCallback((id: string) => dispatch({ type: 'TOGGLE_APP', id }), []);

  const recordAttempt = useCallback(
    (appName: string) => {
      punish('blocked_app', `Intercepted launch of ${appName} during a sealed session.`, -8, false);
    },
    [punish]
  );

  const setGate = useCallback((gate: RouteGate) => dispatch({ type: 'SET_GATE', gate }), []);

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      login,
      signOut,
      finishOnboarding,
      finishPermissions,
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
      finishPermissions,
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
