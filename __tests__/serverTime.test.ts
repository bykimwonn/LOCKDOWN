import {
  applyServerNow,
  clockSkewMs,
  formatClock,
  formatDay,
  formatRemain,
  serverNow,
  serverNowIso,
} from '@/src/services/serverTime';
import { toIso } from '@/src/services/api';

describe('serverTime', () => {
  beforeEach(() => {
    // reset offset by applying "now" as server time
    applyServerNow(new Date().toISOString());
  });

  it('reports zero skew after syncing to device time', () => {
    applyServerNow(new Date().toISOString());
    expect(clockSkewMs()).toBeLessThan(1000);
  });

  it('adds a server offset to local time', () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString(); // server 5 min ahead
    applyServerNow(future);
    expect(clockSkewMs()).toBeGreaterThan(4 * 60_000);
    expect(serverNow().getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
  });

  it('handles a server that is behind the device clock', () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    applyServerNow(past);
    expect(clockSkewMs()).toBeGreaterThan(9 * 60_000);
    expect(serverNow().getTime()).toBeLessThan(Date.now());
  });

  it('serverNowIso is valid ISO', () => {
    expect(Number.isNaN(Date.parse(serverNowIso()))).toBe(false);
  });

  it('ignores garbage timestamps instead of NaN-ing the offset', () => {
    applyServerNow('not-a-date');
    expect(clockSkewMs()).toBeLessThan(1000);
  });

  it('formatRemain clamps negatives and renders h:mm:ss', () => {
    expect(formatRemain(-5000)).toBe('00:00');
    expect(formatRemain(0)).toBe('00:00');
    expect(formatRemain(65_000)).toBe('01:05');
    expect(formatRemain(3_725_000)).toBe('1:02:05');
  });

  it('formatClock / formatDay do not throw', () => {
    expect(typeof formatClock(new Date().toISOString())).toBe('string');
    expect(typeof formatDay(new Date().toISOString())).toBe('string');
  });
});

describe('toIso (timestamp parsing — the phantom clock-tamper bug class)', () => {
  it('treats naive UTC strings as UTC', () => {
    expect(toIso('2026-08-30 10:00:00')).toMatch(/2026-08-30T10:00:00.*Z/);
  });

  it('passes Z-suffixed ISO through unchanged', () => {
    expect(toIso('2026-08-30T10:00:00Z')).toBe('2026-08-30T10:00:00.000Z');
  });

  it('does not reinterpret a Z time as device-local', () => {
    const a = Date.parse(toIso('2026-08-30T10:00:00Z'));
    const b = Date.parse('2026-08-30T10:00:00Z');
    expect(a).toBe(b);
  });
});
