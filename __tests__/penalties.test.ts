import { penaltyFor } from '@/src/services/penalties';

describe('penalty table', () => {
  it('blocked app: 1st is a warning, 2nd is -10, 3rd+ is -25 + streak', () => {
    expect(penaltyFor('blocked_app', 1)).toEqual({ eloDelta: 0, breakStreak: false, scored: false });
    expect(penaltyFor('blocked_app', 2)).toEqual({ eloDelta: -10, breakStreak: false, scored: true });
    expect(penaltyFor('blocked_app', 3)).toEqual({ eloDelta: -25, breakStreak: true, scored: true });
    expect(penaltyFor('blocked_app', 9)).toEqual({ eloDelta: -25, breakStreak: true, scored: true });
  });

  it('force quit and emergency unlock are -25 + streak', () => {
    expect(penaltyFor('force_quit', 1)).toEqual({ eloDelta: -25, breakStreak: true, scored: true });
    expect(penaltyFor('emergency_unlock', 1)).toEqual({
      eloDelta: -25,
      breakStreak: true,
      scored: true,
    });
  });

  it('tamper-class events are -50 + streak', () => {
    for (const t of ['accessibility_off', 'admin_disabled', 'permission_revoked', 'time_tamper'] as const) {
      expect(penaltyFor(t, 1)).toEqual({ eloDelta: -50, breakStreak: true, scored: true });
    }
  });

  it('heartbeat miss is never scored (network blips are not violations)', () => {
    expect(penaltyFor('heartbeat_miss', 1)).toEqual({
      eloDelta: 0,
      breakStreak: false,
      scored: false,
    });
  });
});
