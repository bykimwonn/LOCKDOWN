import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearOutbox,
  drainOutbox,
  initOutbox,
  outboxCount,
  setOutboxRunner,
  withOutbox,
} from '@/src/services/outbox';

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearOutbox();
  jest.restoreAllMocks();
});

it('returns true without queueing when the call succeeds', async () => {
  const fn = jest.fn().mockResolvedValue(undefined);
  const ok = await withOutbox('event', { a: 1 }, fn);
  expect(ok).toBe(true);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(outboxCount()).toBe(0);
});

it('queues on failure and replays in FIFO order on the next drain', async () => {
  await initOutbox();
  const calls: string[] = [];
  let failNext = true;
  setOutboxRunner(async (label, payload) => {
    calls.push((payload as { id: string }).id);
  });

  // First two attempts fail server-side -> queued.
  await withOutbox('event', { id: 'one' }, async () => {
    if (failNext) throw new Error('network down');
  });
  failNext = false;
  await withOutbox('event', { id: 'two' }, async () => {
    throw new Error('network down');
  });
  expect(outboxCount()).toBe(2);

  // Drain replays the queue through the runner, oldest first (FIFO).
  await drainOutbox();
  expect(calls).toEqual(['one', 'two']);
  expect(outboxCount()).toBe(0);
});

it('stops the drain at the first failing item and keeps order', async () => {
  await initOutbox();
  const sent: string[] = [];
  setOutboxRunner(async (_label, payload) => {
    const id = (payload as { id: string }).id;
    if (id === 'two') throw new Error('still failing');
    sent.push(id);
  });

  await withOutbox('event', { id: 'one' }, async () => {
    throw new Error('offline');
  });
  await withOutbox('event', { id: 'two' }, async () => {
    throw new Error('offline');
  });
  await withOutbox('event', { id: 'three' }, async () => {
    throw new Error('offline');
  });

  await drainOutbox();
  // 'one' delivered; 'two' blocks the queue so 'three' stays behind it.
  expect(sent).toEqual(['one']);
  expect(outboxCount()).toBe(2);

  // Next drain with the runner now healthy clears the rest in order.
  setOutboxRunner(async (_label, payload) => {
    sent.push((payload as { id: string }).id);
  });
  await drainOutbox();
  expect(sent).toEqual(['one', 'two', 'three']);
  expect(outboxCount()).toBe(0);
});
