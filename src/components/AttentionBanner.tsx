import { computeAttention, SNOOZE_MS, type Attention } from '@/src/services/attention';
import { serverNow } from '@/src/services/serverTime';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * The single source of "what should I tell the student about their grants".
 * Every screen reads this instead of looking at `permissions` directly, so no
 * screen can drift back into hijacking the router on a dead accessibility seal.
 */
export function useAttention(): Attention {
  const { permissions, setupDone, enforcementAvailable, lockdown, attentionSnoozeUntil } = useApp();
  const sealed = lockdown.active;
  return useMemo(
    () =>
      computeAttention({
        setupComplete: setupDone,
        linked: enforcementAvailable,
        permissions,
        sealed,
        snoozeUntil: attentionSnoozeUntil,
        now: serverNow().getTime(),
      }),
    // `now` is intentionally excluded: it only matters against the snooze deadline,
    // and re-rendering on a clock here is pointless work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions, setupDone, enforcementAvailable, sealed, attentionSnoozeUntil]
  );
}

/**
 * A red (or amber) strip at the top of Home — the post-setup replacement for the
 * permissions screen. Deliberately not a modal and not a route change: on this
 * phone the seal can die twenty times a day, and each one used to throw the whole
 * app back to "Arm the operating system".
 */
export function AttentionBanner() {
  const a = useAttention();
  const { openSealSettings, snoozeAttention } = useApp();
  const router = useRouter();

  // takeOverScreen cases are handled by the router gate (first-run setup flow), and
  // a hidden banner must not cost a layout slot either.
  if (!a.show || a.takeOverScreen) return null;

  const crimson = a.tone === 'crimson';
  const accent = crimson ? colors.crimson : colors.amber;

  const fix = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (a.ctaOpensSystemSettings) await openSealSettings();
    else router.push('/permissions');
  };

  return (
    <View style={[styles.box, { borderColor: `${accent}66`, backgroundColor: `${accent}14` }]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.headline, { color: accent }]}>{a.headline}</Text>
      </View>
      <Text style={styles.body}>{a.body}</Text>
      <View style={styles.actions}>
        <Pressable onPress={fix} style={[styles.cta, { backgroundColor: accent }]} hitSlop={6}>
          <Text style={styles.ctaText}>{a.cta}</Text>
        </Pressable>
        {a.dismissible ? (
          <Pressable
            onPress={() => {
              snoozeAttention(SNOOZE_MS).catch(() => undefined);
            }}
            hitSlop={10}
          >
            <Text style={styles.later}>Later</Text>
          </Pressable>
        ) : (
          <Text style={styles.lockedNote}>
            {crimson ? 'Shows until the seal is back' : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headline: { fontFamily: fonts.sansSemi, fontSize: 15, letterSpacing: 0.2 },
  body: { color: colors.inkMute, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cta: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  ctaText: { color: '#0A0A0C', fontFamily: fonts.sansSemi, fontSize: 13 },
  later: { color: colors.inkMute, fontFamily: fonts.sans, fontSize: 13, textDecorationLine: 'underline' },
  lockedNote: { color: colors.inkFaint, fontFamily: fonts.sans, fontSize: 11 },
});
