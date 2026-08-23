import { Platform } from 'react-native';
import { apiUrl, getToken, setToken } from '@/src/config';
import { applyServerNow, serverNowIso } from '@/src/services/serverTime';
import type { DeepWorkSession, SyncFlag, UserProfile, Violation } from '@/src/types';

function mapEventType(type: string) {
  if (type === 'blocked_app') return 'block_attempt';
  if (type === 'force_quit' || type === 'emergency_unlock') return 'force_quit';
  if (type === 'permission_revoked' || type === 'accessibility_off' || type === 'time_tamper') {
    return 'tamper_detected';
  }
  return 'block_attempt';
}

function toIso(value?: string) {
  if (!value) return serverNowIso();
  const trimmed = String(value).trim().replace(' ', 'T');
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
  const res = await fetch(apiUrl(path), { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    serverNow?: string;
    server_time?: string;
  };
  if (data.serverNow) applyServerNow(data.serverNow);
  else if (data.server_time) applyServerNow(toIso(data.server_time));
  if (!res.ok) {
    const err = new Error(data.error || `http_${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return data;
}

export async function loginToLearning(id: string, password: string): Promise<{ user: UserProfile; token: string }> {
  const data = await req<{ user: UserProfile; token: string }>('/api/lockdown/login', {
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

export async function pullSyncFlag(): Promise<SyncFlag & { user?: UserProfile; subject?: string; title?: string }> {
  const data = await req<{
    active: boolean;
    session_id?: number | string;
    subject?: string;
    end_time?: string;
    remaining_seconds?: number;
    server_time?: string;
    session_type?: string;
  }>('/api/lockdown/current');

  const endsAt = data.end_time ? toIso(data.end_time) : undefined;
  const startsAt = data.remaining_seconds != null && endsAt
    ? new Date(Date.parse(endsAt) - data.remaining_seconds * 1000).toISOString()
    : undefined;

  return {
    userId: '',
    lockdownActive: Boolean(data.active),
    sessionId: data.session_id != null ? String(data.session_id) : undefined,
    serverNow: data.server_time ? toIso(data.server_time) : serverNowIso(),
    startsAt,
    endsAt,
    revision: Date.now(),
    subject: data.subject,
    title: data.subject ? `Deep Work · ${data.subject}` : 'Deep Work',
  };
}

export async function pushHeartbeat(sessionId: string, _subject?: string) {
  try {
    await req('/api/lockdown/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, client_time: serverNowIso() }),
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
  try {
    const appName = payload.detail.replace(/^Intercepted launch of\s+/i, '').replace(/\s+during.*$/i, '');
    await req('/api/lockdown/event', {
      method: 'POST',
      body: JSON.stringify({
        session_id: payload.sessionId ? Number(payload.sessionId) || payload.sessionId : undefined,
        event_type: mapEventType(payload.type),
        app_name: appName,
        device_platform: Platform.OS === 'ios' ? 'ios' : 'android',
        reason: payload.detail,
      }),
    });
    const me = await req<{ user: UserProfile }>('/api/lockdown/me');
    return me.user;
  } catch {
    return null;
  }
}

export async function completeSession(sessionId: string, _minutes: number, _subject?: string): Promise<UserProfile | null> {
  try {
    await req('/api/lockdown/complete', {
      method: 'POST',
      body: JSON.stringify({
        session_id: Number(sessionId) || sessionId,
        violations: 0,
      }),
    });
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

export async function logoutRemote() {
  setToken('');
}
