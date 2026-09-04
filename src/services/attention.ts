/**
 * "What still needs to be enabled" — decided once, then only when it breaks.
 *
 * WHY THIS EXISTS
 * The setup screen (app/permissions.tsx) used to be the app's answer to a missing
 * permission *at any time*, so on a Xiaomi/Redmi — where the accessibility seal is
 * switched off by the OS constantly — the student was thrown back to "Arm the
 * operating system" on essentially every open, mid-session, for a thing they had
 * already configured. That is both terrible UX and an easy way to make the app
 * feel broken/locked up: the redirect fights the 4 s sync loop for control of the
 * router.
 *
 * The rule this module encodes instead:
 *
 *   first run, setup never completed  → the setup screen (once, on purpose)
 *   after that, seal is off          → a red banner + a system notification
 *                                      (never a route change, never a screen hijack)
 *
 * It is deliberately a pure function of state so the policy can be unit-tested and
 * so no screen can drift into re-introducing the hijack. The native side mirrors
 * the same threshold in LockdownOverlayService (sealAlert* prefs) because the
 * notification has to be right even when JS is dead.
 */
import type { PermissionStatus } from '@/src/types';

export type AttentionKind = 'none' | 'setup' | 'seal_off' | 'overlay_off' | 'not_linked';

export type AttentionInput = {
  /** The student finished the first-run "Arm the operating system" screen. */
  setupComplete: boolean;
  /** The React-native module is linked (an Expo Go / web build has no enforcement). */
  linked: boolean;
  permissions: PermissionStatus;
  /** A sealed session is running right now — a student must not snooze past it. */
  sealed: boolean;
  /** Epoch ms until which the in-app banner is snoozed (0 = never). */
  snoozeUntil: number;
  /** Epoch ms, injected so this stays pure and testable. */
  now: number;
};

export type Attention = {
  kind: AttentionKind;
  /** Show the banner in the app. */
  show: boolean;
  /** Show the full setup screen. True ONLY on first run — never a mid-use hijack. */
  takeOverScreen: boolean;
  tone: 'crimson' | 'amber';
  headline: string;
  body: string;
  cta: string;
  /** The CTA opens the system Accessibility page (true) or the in-app setup screen (false). */
  ctaOpensSystemSettings: boolean;
  /** "Later" is offered only when it is legal to be quiet about it. */
  dismissible: boolean;
};

const NONE: Attention = {
  kind: 'none',
  show: false,
  takeOverScreen: false,
  tone: 'amber',
  headline: '',
  body: '',
  cta: '',
  ctaOpensSystemSettings: false,
  dismissible: false,
};

/** One hour of quiet — long enough to finish what you are doing, short enough to matter. */
export const SNOOZE_MS = 60 * 60 * 1000;

/**
 * The whole policy in one place: a banner can be snoozed, a *sealed session's*
 * warning cannot. `app/lockdown.tsx` shows the seal state permanently while a
 * session runs, so anything that could hide the prompt mid-session would be a way
 * for a student to make the problem invisible to themselves and to the teacher.
 */
function withSnooze(i: AttentionInput, a: Attention): Attention {
  if (!a.show || i.sealed) return a;
  if (i.snoozeUntil > i.now) return { ...a, show: false, dismissible: false };
  return a;
}

export function computeAttention(i: AttentionInput): Attention {
  // No native module at all (Expo Go, web): nagging about accessibility would be a
  // lie, because nothing the app can do there would change it. Say what is missing
  // once, in a card, and leave the student alone.
  if (!i.linked) {
    return withSnooze(
      i,
      {
        ...NONE,
        kind: 'not_linked',
        show: !i.setupComplete,
        tone: 'amber',
        headline: 'Enforcement is not linked',
        body:
          'This build cannot reach the BT LOCKDOWN native layer, so it cannot seal the phone. Build the APK from the repo (Setup guide) and sign in again.',
        cta: 'Setup guide',
        dismissible: true,
      }
    );
  }

  const a11yOk = i.permissions.accessibility === 'granted';
  // A build that cannot ask for the overlay grant (iOS, web) must not be treated as
  // "denied" forever; only Android has this permission at all.
  const overlayOk = i.permissions.overlay === 'granted' || i.permissions.overlay === 'unavailable';
  if (a11yOk && overlayOk) return NONE;

  // First run: the setup screen is the right UI — it walks through the grants in the
  // only order Android accepts them. After that we never hijack a screen, because on
  // MIUI the seal can drop twenty times a day and the student has already done setup.
  if (!i.setupComplete) {
    return {
      ...NONE,
      kind: 'setup',
      show: true,
      takeOverScreen: true,
      tone: 'amber',
      headline: 'Arm the operating system',
      body: 'BT LOCKDOWN needs the system grants below before it can seal the phone. This is set up once.',
      cta: 'Start setup',
    };
  }

  if (!a11yOk) {
    return withSnooze(i, {
      ...NONE,
      kind: 'seal_off',
      show: true,
      tone: 'crimson',
      headline: 'Seal service is off',
      body:
        'Android (or the battery manager on this phone) switched BT LOCKDOWN\u2019s seal service off, so blocked apps are not being intercepted. Re-enable it \u2014 your session, the barrier and the network shield keep running meanwhile.',
      cta: 'Re-enable now',
      ctaOpensSystemSettings: true,
      // During a sealed session the warning is part of the enforcement record: a
      // student may acknowledge it, never make it disappear.
      dismissible: !i.sealed,
    });
  }

  return withSnooze(i, {
    ...NONE,
    kind: 'overlay_off',
    show: true,
    tone: 'amber',
    headline: 'Seal screen is off',
    body:
      'The full-screen barrier needs "Display over other apps". Launch interception still works; the sealed countdown just cannot draw over a distractor.',
    cta: 'Open overlay setting',
    ctaOpensSystemSettings: true,
    dismissible: !i.sealed,
  });
}

/**
 * Whether the seal *used* to work and stopped — the difference between "you never
 * set this up" and "the connection dropped". `everEnabled` comes from native (AccessibilityHealth records the
 * first successful bind), so the app can stay quiet
 * during setup and loud afterwards.
 */
export function sealDropped(everEnabled: boolean, enforcing: boolean): boolean {
  return everEnabled && !enforcing;
}
