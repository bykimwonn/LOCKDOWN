import type { ViolationType } from '@/src/types';

/**
 * Single source of truth for the client-side penalty preview.
 * The server (BT LEARNING) applies the real penalties; these numbers must
 * mirror it so the app tells the truth. Pure + unit-tested.
 *
 *  - blocked app:       1st = warning, 2nd = -10, 3rd+ = -25 + streak broken
 *  - force quit / emergency unlock: -25 + streak broken
 *  - permission revoked / accessibility off / admin removed / clock tamper:
 *                       -50 + streak broken
 *  - heartbeat miss:    local only, never scored
 */
export interface Penalty {
  eloDelta: number;
  breakStreak: boolean;
  scored: boolean;
}

export function penaltyFor(type: ViolationType, blockCount: number): Penalty {
  if (type === 'blocked_app') {
    if (blockCount <= 1) return { eloDelta: 0, breakStreak: false, scored: false };
    if (blockCount === 2) return { eloDelta: -10, breakStreak: false, scored: true };
    return { eloDelta: -25, breakStreak: true, scored: true };
  }
  if (type === 'force_quit' || type === 'emergency_unlock') {
    return { eloDelta: -25, breakStreak: true, scored: true };
  }
  if (
    type === 'accessibility_off' ||
    type === 'admin_disabled' ||
    type === 'permission_revoked' ||
    type === 'time_tamper'
  ) {
    return { eloDelta: -50, breakStreak: true, scored: true };
  }
  // heartbeat_miss and anything unknown: local only
  return { eloDelta: 0, breakStreak: false, scored: false };
}
