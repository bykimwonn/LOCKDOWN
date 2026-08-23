import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline outbox for state-changing calls (violations, session completion).
 * A failed call is queued to AsyncStorage and retried in order on the next
 * drain. Reads (me / sync / schedule) never go through the outbox.
 */

const KEY = 'bt.lockdown.outbox.v1';

export type OutboxLabel = 'event' | 'complete';

interface Item {
  id: string;
  label: OutboxLabel;
  payload: string; // JSON
  at: number;
  tries: number;
}

let queue: Item[] = [];
let draining = false;
let inited = false;

type Runner = (label: OutboxLabel, payload: unknown) => Promise<unknown>;

let runner: Runner = async () => {
  throw new Error('outbox runner not set');
};

export function setOutboxRunner(r: Runner) {
  runner = r;
}

export async function initOutbox() {
  if (inited) return;
  inited = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    queue = raw ? (JSON.parse(raw) as Item[]) : [];
  } catch {
    queue = [];
  }
}

export function outboxCount(): number {
  return queue.length;
}

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* storage full — drop the oldest so the newest survive */
    queue = queue.slice(-50);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(queue));
    } catch {
      /* give up */
    }
  }
}

/**
 * Run a state-changing call. On failure, queue it for retry.
 * Returns true when the server accepted it (now or later).
 */
export async function withOutbox(label: OutboxLabel, payload: unknown, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    queue.push({
      id: `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label,
      payload: JSON.stringify(payload),
      at: Date.now(),
      tries: 0,
    });
    await persist();
    return false;
  }
}

export async function clearOutbox() {
  queue = [];
  await persist();
}

/** Retry queued items in order. Stops at the first failure (FIFO order matters). */
export async function drainOutbox() {
  if (draining || queue.length === 0) return;
  draining = true;
  try {
    let progress = true;
    while (progress && queue.length > 0) {
      const item = queue[0];
      let payload: unknown = {};
      try {
        payload = JSON.parse(item.payload);
      } catch {
        queue.shift();
        continue;
      }
      try {
        await runner(item.label, payload);
        queue.shift();
      } catch {
        item.tries += 1;
        if (item.tries >= 30) queue.shift(); // poison pill — give up after 30 tries
        progress = false;
      }
      await persist();
    }
  } finally {
    draining = false;
  }
}
