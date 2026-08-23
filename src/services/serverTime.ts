/**
 * Universal server time.
 * Local clocks are untrusted — students can rewind them.
 * All lockdown duration math uses this clock.
 */

let offsetMs = 0;
let lastSyncAt = 0;

export function applyServerNow(iso: string) {
  const server = Date.parse(iso);
  if (Number.isNaN(server)) return;
  offsetMs = server - Date.now();
  lastSyncAt = Date.now();
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function serverNowIso(): string {
  return serverNow().toISOString();
}

export function clockSkewMs(): number {
  return Math.abs(offsetMs);
}

export function lastSyncedAgoMs(): number {
  return lastSyncAt ? Date.now() - lastSyncAt : Number.POSITIVE_INFINITY;
}

export function formatRemain(ms: number): string {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
