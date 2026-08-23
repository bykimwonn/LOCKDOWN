import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DeepWorkSession } from '@/src/types';

/**
 * Local notifications for upcoming Deep Work sessions.
 * If the timetable starts a session while the phone is backgrounded, the
 * full-screen wake notification gets the student back to BT LOCKDOWN, where
 * the 4s sync tick arms enforcement.
 */

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/** Idempotent: schedules starts in the next 24h, cancels the stale ones. */
export function scheduleSessionStarts(sessions: DeepWorkSession[]) {
  if (Platform.OS !== 'android') return;
  const now = Date.now();
  const wanted = new Set<string>();
  const toSchedule: { id: string; when: Date; title: string }[] = [];

  for (const s of sessions) {
    const t = Date.parse(s.startsAt);
    if (!Number.isFinite(t)) continue;
    if (t < now + 15_000 || t > now + 24 * 3600 * 1000) continue;
    const id = `start_${s.id}`;
    wanted.add(id);
    toSchedule.push({ id, when: new Date(t), title: s.title || 'Deep Work' });
  }

  (async () => {
    try {
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      const mine = new Set(
        existing
          .map((n) => n.identifier)
          .filter((x): x is string => typeof x === 'string' && x.startsWith('start_'))
      );
      for (const id of mine) {
        if (!wanted.has(id)) {
          await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
        }
      }
      for (const item of toSchedule) {
        if (mine.has(item.id)) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: item.id,
          content: {
            title: 'Deep Work is starting',
            body: `${item.title} — BT LOCKDOWN is sealing this phone. Open the app to begin.`,
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: item.when,
          },
        }).catch(() => undefined);
      }
    } catch {
      /* notifications are best-effort; enforcement does not depend on them */
    }
  })();
}
