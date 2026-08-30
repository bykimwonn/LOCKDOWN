import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { DeepWorkSession } from '@/src/types';

/**
 * Local notification ladder for the AI timetable.
 *
 * The timetable is server-driven: when a block's start time arrives the server
 * flips BT LOCKDOWN into a locked session and the 4s sync loop arms it. These
 * local notifications are the *advance* warnings so the student is not caught
 * flat-footed:
 *   BEFORE  (start - 15m)  -> "get ready, this phone is about to be sealed"
 *   10 MIN (start - 10m)   -> "10 minutes until lockdown"
 *   3 MIN  (start - 3m)    -> "3 minutes — lockdown is imminent"
 *   ONSET  (at start)      -> full-screen wake (existing behaviour, kept)
 *
 * They are pure scheduling hints: enforcement itself never depends on them, so
 * a missed notification can never loosen the lock.
 */

const PREPARE_LEAD_MS = 15 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const THREE_MIN_MS = 3 * 60 * 1000;
const WINDOW_MS = 24 * 3600 * 1000;

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

function buildItems(sessions: DeepWorkSession[]): {
  id: string;
  when: Date;
  title: string;
  body: string;
  priority?: Notifications.AndroidNotificationPriority;
}[] {
  const now = Date.now();
  const items: { id: string; when: Date; title: string; body: string; priority?: Notifications.AndroidNotificationPriority }[] = [];
  for (const s of sessions) {
    const t = Date.parse(s.startsAt);
    if (!Number.isFinite(t)) continue;
    // Only schedule warnings that are still in the future and within 24h.
    if (t > now + WINDOW_MS) continue;
    const name = s.title || 'Deep Work';

    const prepareAt = t - PREPARE_LEAD_MS;
    if (prepareAt > now + 3000) {
      items.push({
        id: `prepare_${s.id}`,
        when: new Date(prepareAt),
        title: 'BT LOCKDOWN prepares to seal',
        body: `${name} starts in 15 minutes. Put your books out and settle in — this phone will lock itself.`,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      });
    }

    const tenAt = t - TEN_MIN_MS;
    if (tenAt > now + 3000) {
      items.push({
        id: `t10_${s.id}`,
        when: new Date(tenAt),
        title: '10 minutes to lockdown',
        body: `${name} begins in 10 minutes. BT LOCKDOWN will block every app that is not on your study whitelist.`,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      });
    }

    const threeAt = t - THREE_MIN_MS;
    if (threeAt > now + 3000) {
      items.push({
        id: `t3_${s.id}`,
        when: new Date(threeAt),
        title: '3 minutes — lockdown imminent',
        body: `${name} starts in 3 minutes. The phone is about to seal. Get into BT LOCKDOWN now.`,
        priority: Notifications.AndroidNotificationPriority.MAX,
      });
    }

    const startAt = t;
    if (startAt > now + 3000) {
      items.push({
        id: `start_${s.id}`,
        when: new Date(startAt),
        title: 'Deep Work is starting',
        body: `${name} — BT LOCKDOWN is sealing this phone. Open the app to begin.`,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      });
    }
  }
  return items;
}

/** Idempotent: schedules the ladder for the next 24h, cancels stale ones. */
export function scheduleSessionStarts(sessions: DeepWorkSession[]) {
  if (Platform.OS !== 'android') return;

  const wanted = new Set<string>();
  for (const item of buildItems(sessions)) wanted.add(item.id);

  (async () => {
    try {
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      const mine = new Set<string>(
        existing
          .map((n) => (n as { identifier?: unknown }).identifier)
          .filter((x): x is string => typeof x === 'string' && /^(prepare_|t10_|t3_|start_)/.test(x))
      );
      for (const id of mine) {
        if (!wanted.has(id)) {
          await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
        }
      }
      for (const item of buildItems(sessions)) {
        if (mine.has(item.id)) continue;
        const trigger = {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: item.when,
        } as Notifications.NotificationTriggerInput;
        await Notifications.scheduleNotificationAsync({
          identifier: item.id,
          content: {
            title: item.title,
            body: item.body,
            sound: 'default',
            priority: item.priority,
          },
          trigger,
        }).catch(() => undefined);
      }
    } catch {
      /* notifications are best-effort; enforcement does not depend on them */
    }
  })();
}

/**
 * Cancel every scheduled BT LOCKDOWN notification. Called on sign-out / when
 * the user removes the device so stale "prepare for lockdown" pings do not
 * fire for a session that will never happen.
 */
export async function cancelAllScheduledNotifications() {
  if (Platform.OS !== 'android') return;
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of existing) {
      const id = (n as { identifier?: unknown }).identifier;
      if (typeof id === 'string' && /^(prepare_|t10_|t3_|start_)/.test(id)) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
      }
    }
  } catch {
    /* best-effort */
  }
}
