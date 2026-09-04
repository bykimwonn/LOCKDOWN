/**
 * The "show setup once, then only nag when it actually breaks" policy.
 *
 * These tests exist because the old behaviour was a real bug on the target devices:
 * arm() routed to /permissions whenever the seal was off, and MIUI switches the seal
 * off constantly — so the app threw the student at the setup screen on nearly every
 * open and mid-session, and fought the sync loop for the router. The policy is now a
 * pure function (src/services/attention.ts); keep it that way.
 */
import { computeAttention, sealDropped, SNOOZE_MS, type AttentionInput } from '@/src/services/attention';
import type { PermissionStatus } from '@/src/types';

const NOW = 1_700_000_000_000;

const perms = (over: Partial<PermissionStatus> = {}): PermissionStatus => ({
  screenTime: 'unavailable',
  accessibility: 'granted',
  overlay: 'granted',
  notifications: 'granted',
  ...over,
});

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  setupComplete: true,
  linked: true,
  permissions: perms(),
  sealed: false,
  snoozeUntil: 0,
  now: NOW,
  ...over,
});

describe('attention policy — first run vs later breakage', () => {
  it('is completely silent when the grants are in place', () => {
    const a = computeAttention(input());
    expect(a.kind).toBe('none');
    expect(a.show).toBe(false);
    expect(a.takeOverScreen).toBe(false);
  });

  it('lets the setup screen take over the app only before setup is done', () => {
    const a = computeAttention(
      input({ setupComplete: false, permissions: perms({ accessibility: 'denied', overlay: 'denied' }) })
    );
    expect(a.kind).toBe('setup');
    expect(a.takeOverScreen).toBe(true);
    // No "Later" on first run: the app genuinely cannot enforce anything yet.
    expect(a.dismissible).toBe(false);
  });

  it('after setup a dead seal is a banner, never a screen the app drags you to', () => {
    const a = computeAttention(input({ permissions: perms({ accessibility: 'denied' }) }));
    expect(a.kind).toBe('seal_off');
    expect(a.show).toBe(true);
    expect(a.takeOverScreen).toBe(false);
    expect(a.tone).toBe('crimson');
    expect(a.ctaOpensSystemSettings).toBe(true);
    expect(a.headline).toBe('Seal service is off');
    // Tells the truth about what still holds, because that is what the student asks.
    expect(a.body).toMatch('network shield keep running');
  });

  it('says "blocked apps are not intercepted" instead of "permission denied"', () => {
    const a = computeAttention(input({ permissions: perms({ accessibility: 'denied' }) }));
    expect(a.body).toMatch('not being intercepted');
    expect(a.body.toLowerCase()).not.toMatch('install');
  });

  it('overlay-only gaps are amber and worded differently from a dead seal', () => {
    const a = computeAttention(input({ permissions: perms({ overlay: 'denied' }) }));
    expect(a.kind).toBe('overlay_off');
    expect(a.tone).toBe('amber');
    expect(a.cta).toBe('Open overlay setting');
  });

  it('does not treat a platform without the overlay permission as broken', () => {
    expect(computeAttention(input({ permissions: perms({ overlay: 'unavailable' }) })).kind).toBe('none');
  });

  it('does not nag about accessibility in an unlinked build', () => {
    const a = computeAttention(input({ linked: false, permissions: perms({ accessibility: 'denied' }) }));
    expect(a.kind).toBe('not_linked');
    expect(a.takeOverScreen).toBe(false);
    expect(a.ctaOpensSystemSettings).toBe(false);
  });

  it('an unlinked build during first run still points at the guide', () => {
    expect(computeAttention(input({ linked: false, setupComplete: false })).show).toBe(true);
  });
});

describe('snooze and "Later"', () => {
  it('a snooze silences the banner while idle', () => {
    const a = computeAttention(
      input({ permissions: perms({ accessibility: 'denied' }), snoozeUntil: NOW + SNOOZE_MS })
    );
    expect(a.show).toBe(false);
    expect(a.dismissible).toBe(false);
  });

  it('a sealed session ignores the snooze — you cannot hide the warning mid-session', () => {
    const a = computeAttention(
      input({
        permissions: perms({ accessibility: 'denied' }),
        sealed: true,
        snoozeUntil: NOW + SNOOZE_MS,
      })
    );
    expect(a.show).toBe(true);
    expect(a.dismissible).toBe(false);
  });

  it('outside a session the banner offers "Later"', () => {
    expect(computeAttention(input({ permissions: perms({ accessibility: 'denied' }) })).dismissible).toBe(true);
  });

  it('an expired snooze does not hide anything', () => {
    const a = computeAttention(
      input({ permissions: perms({ accessibility: 'denied' }), snoozeUntil: NOW - 1 })
    );
    expect(a.show).toBe(true);
  });
});

describe('sealDropped (never-configured vs killed)', () => {
  it('is false before the seal has ever bound, so setup is not double-nagged', () => {
    expect(sealDropped(false, false)).toBe(false);
  });

  it('is true once a working seal disappears', () => {
    expect(sealDropped(true, false)).toBe(true);
  });

  it('stays false while the seal is healthy', () => {
    expect(sealDropped(true, true)).toBe(false);
  });
});
