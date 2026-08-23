import { Ambient, Button, Display, Label } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGES = [
  {
    kicker: '01  ·  Companion',
    title: 'The timetable fires.\nThe phone obeys.',
    body: 'BT LOCKDOWN is the native companion to BT LEARNING. When the AI timetable enters a study block, the same PostgreSQL record the website uses flips this device into lockdown.',
  },
  {
    kicker: '02  ·  Enforcement',
    title: 'System-level.\nNot a suggestion.',
    body: 'iOS uses Apple Family Controls and ManagedSettings shields. Android uses an Accessibility Service that intercepts launches in real time — tuned for devices like Redmi.',
  },
  {
    kicker: '03  ·  Zero tolerance',
    title: 'Cheat the clock.\nLose the streak.',
    body: 'Local time is untrusted. Durations run on server time. Force-quit, revoke permissions, or emergency-unlock and BT LEARNING deducts ELO and breaks the streak.',
  },
];

export default function Onboarding() {
  const { finishOnboarding } = useApp();
  const [i, setI] = useState(0);
  const inset = useSafeAreaInsets();
  const page = PAGES[i];

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (i < PAGES.length - 1) setI(i + 1);
    else finishOnboarding();
  };

  return (
    <View style={[styles.root, { paddingTop: inset.top + 18, paddingBottom: inset.bottom + 18 }]}>
      <Ambient />
      <View style={styles.top}>
        <Label tone="amber">BT LOCKDOWN</Label>
        <Pressable onPress={finishOnboarding} hitSlop={12}>
          <Label>Skip</Label>
        </Pressable>
      </View>
      <View style={styles.mid}>
        <Label tone="ink">{page.kicker}</Label>
        <Display style={{ marginTop: 16 }}>{page.title}</Display>
        <Text style={styles.body}>{page.body}</Text>
      </View>
      <View style={styles.bot}>
        <View style={styles.dots}>
          {PAGES.map((_, n) => (
            <View key={n} style={[styles.dot, n === i && styles.dotOn]} />
          ))}
        </View>
        <Button title={i === PAGES.length - 1 ? 'Pair with BT LEARNING' : 'Continue'} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mid: { flex: 1, justifyContent: 'center', paddingBottom: 24 },
  body: {
    fontFamily: fonts.sans,
    color: colors.inkMute,
    fontSize: 16,
    lineHeight: 25,
    marginTop: 18,
    maxWidth: 360,
  },
  bot: { gap: 18 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 8, backgroundColor: colors.lineStrong },
  dotOn: { width: 26, backgroundColor: colors.amber },
});
