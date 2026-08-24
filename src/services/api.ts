import { Platform } from 'react-native';
import { apiUrl, getToken, setToken } from '@/src/config';
import { applyServerNow, serverNowIso } from '@/src/services/serverTime';
import { withOutbox } from '@/src/services/outbox';
import type { DeepWorkSession, SyncFlag, UserProfile, Violation } from '@/src/types';

/** Violation types that stay on the phone (never reported to the server). */
const LOCAL_ONLY = new Set(['heartbeat_miss']);

function mapEventType(type: string): string {
  if (type === 'blocked_app') return 'block_attempt';
  if (type === 'force_quit' || type === 'emergency_unlock') return 'force_quit';
  if (type === 'permission_revoked' || type === 'accessibility_off' || type === 'time_tamper') {
    return 'tamper_detected';
  }
  return 'block_attempt';
}

/**
 * Parse a server timestamp. Server timestamps are UTC (Z-suffixed on the
 * updated TEACHING build). Defensive: naive strings are treated as UTC,
 * never as device-local — misparsing this once caused phantom
 * "clock manipulation" penalties.
 */
export function toIso(value?: string): string {
  if (!value) return serverNowIso();
  let trimmed = String(value).trim().replace(' ', 'T');
  if (trimmed && !/Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)) trimmed += 'Z';
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? serverNowIso() : d.toISOString();
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
  };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  // Hard timeout: Render free tier can hang while cold; never wedge the UI.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    // HTML response: redirect, error page, or a sleeping host. Treat as failure
    // so the UI shows SYNC DOWN instead of silently disarming.
    const err = new Error(`http_${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    serverNow?: string;
    server_time?: string;
  };
  if (data.serverNow) applyServerNow(toIso(data.serverNow));
  else if (data.server_time) applyServerNow(toIso(data.server_time));
  if (!res.ok) {
    const err = new Error(data.error || (res.status === 401 ? 'unauthorized' : `http_${res.status}`));
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return data;
}

export async function loginToLearning(id: string, password: string): Promise<{ user: UserProfile; token: string }> {
  const data = await req<{ user: UserProfile; token: string; serverNow?: string }>('/api/lockdown/login', {
    method: 'POST',
    body: JSON.stringify({
      id,
      password,
      device_id: getToken() || undefined,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    }),
  });
  setToken(data.token);
  return data;
}

export async function fetchMe(): Promise<{ user: UserProfile; violations: Violation[] }> {
  return req('/api/lockdown/me');
}

export async function fetchTimetable(): Promise<DeepWorkSession[]> {
  const data = await req<{ sessions: DeepWorkSession[] }>('/api/lockdown/schedule');
  return data.sessions || [];
}

interface CurrentPayload {
  active: boolean;
  session_id?: number | string;
  subject?: string;
  end_time?: string | null;
  remaining_seconds?: number;
  server_time?: string;
  serverNow?: string;
  session_type?: string;
}

function buildFlag(data: CurrentPayload): SyncFlag & { user?: UserProfile; subject?: string; title?: string } {
  const endsAt = data.end_time ? toIso(data.end_time) : undefined;
  const startsAt =
    data.remaining_seconds != null && endsAt
      ? new Date(Date.parse(endsAt) - data.remaining_seconds * 1000).toISOString()
      : undefined;

  return {
    userId: '',
    lockdownActive: Boolean(data.active),
    sessionId: data.session_id != null ? String(data.session_id) : undefined,
    serverNow: data.server_time ? toIso(data.server_time) : data.serverNow ? toIso(data.serverNow) : serverNowIso(),
    startsAt,
    endsAt,
    revision: Date.now(),
    subject: data.subject,
    title: data.subject ? `Deep Work · ${data.subject}` : 'Deep Work',
  };
}

/**
 * The 4s poll. Prefers the merged /api/lockdown/sync endpoint (one
 * round-trip: current session + timetable + user). Falls back to the old
 * two-endpoint shape while the website is still on the pre-sync build.
 */
export async function pullSync(): Promise<
  SyncFlag & { sessions: DeepWorkSession[]; user?: UserProfile; subject?: string; title?: string }
> {
  try {
    const data = await req<CurrentPayload & { sessions?: DeepWorkSession[]; user?: UserProfile }>(
      '/api/lockdown/sync'
    );
    return { ...buildFlag(data), sessions: data.sessions ?? [], user: data.user };
  } catch (e) {
    if ((e as Error & { status?: number }).status === 404) {
      const [flag, sessions] = await Promise.all([pullSyncFlag(), fetchTimetable()]);
      return { ...flag, sessions };
    }
    throw e;
  }
}

export async function pullSyncFlag(): Promise<SyncFlag & { user?: UserProfile; subject?: string; title?: string }> {
  const data = await req<CurrentPayload>('/api/lockdown/current');
  return buildFlag(data);
}

export async function pushHeartbeat(sessionId: string, _subject?: string) {
  try {
    await req('/api/lockdown/heartbeat', {
      method: 'POST',
      // TRUE device time — the server compares it against its UTC clock.
      // (Previously this sent the offset-adjusted "server now", which is
      // self-referential and flagged correct clocks as manipulated.)
      body: JSON.stringify({ session_id: sessionId, client_time: new Date().toISOString() }),
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function reportViolation(payload: {
  type: string;
  sessionId?: string;
  detail: string;
  eloDelta?: number;
  streakBroken?: boolean;
}): Promise<UserProfile | null> {
  if (LOCAL_ONLY.has(payload.type)) return null;
  const appName = payload.detail.replace(/^Intercepted launch of\s+/i, '').replace(/\s+during.*$/i, '');
  const body = {
    session_id: payload.sessionId ? Number(payload.sessionId) || payload.sessionId : undefined,
    event_type: mapEventType(payload.type),
    app_name: appName,
    device_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    reason: payload.detail,
  };
  const accepted = await withOutbox('event', body, () =>
    req('/api/lockdown/event', { method: 'POST', body: JSON.stringify(body) })
  );
  if (!accepted) return null;
  try {
    const me = await req<{ user: UserProfile }>('/api/lockdown/me');
    return me.user;
  } catch {
    return null;
  }
}

export async function completeSession(
  sessionId: string,
  violations: number,
  _subject?: string
): Promise<UserProfile | null> {
  const body = { session_id: Number(sessionId) || sessionId, violations };
  const accepted = await withOutbox('complete', body, () =>
    req('/api/lockdown/complete', { method: 'POST', body: JSON.stringify(body) })
  );
  if (!accepted) return null;
  try {
    const me = await req<{ user: UserProfile }>('/api/lockdown/me');
    return me.user;
  } catch {
    return null;
  }
}

export async function createManualSession(minutes: number, subject = 'Focus') {
  return req<{ session_id: number; start_time: string; end_time: string; subject: string }>(
    '/api/lockdown/create',
    {
      method: 'POST',
      body: JSON.stringify({
        session_type: 'deep_work',
        subject,
        duration_minutes: minutes,
      }),
    }
  );
}

/** Unbind this device on the server (best effort). */
export async function logoutDevice() {
  try {
    await req('/api/lockdown/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    /* offline — the binding simply stays; a later login re-binds */
  }
}

/** Outbox runners: re-send a previously queued mutation. */
export async function retryEvent(payload: Record<string, unknown>) {
  await req('/api/lockdown/event', { method: 'POST', body: JSON.stringify(payload) });
}

export async function retryComplete(payload: Record<string, unknown>) {
  await req('/api/lockdown/complete', { method: 'POST', body: JSON.stringify(payload) });
}

export function setRemoteToken(value: string) {
  setToken(value);
}

export function logoutRemote() {
  setToken('');
}
