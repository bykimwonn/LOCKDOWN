import { Ambient, Button, Display, Label } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGES = [
  {
    kicker: '01  ·  Welcome',
    title: 'The timetable fires.\nThe phone obeys.',
    body: 'Welcome to BT LOCKDOWN — the native companion to BT LEARNING. This short tour shows you what every part of the app is for. Sixty seconds, then you sign in.',
  },
  {
    kicker: '02  ·  Command',
    title: 'Your\nhome base.',
    body: 'The first tab. See your next study block, whether the link to BT LEARNING is live, your ELO and streak — and start a manual 25 or 50 minute focus. The refresh button up top reconnects the whole app if anything looks stale.',
  },
  {
    kicker: '03  ·  Timetable',
    title: 'Blocks from\nyour AI plan.',
    body: 'Your teacher’s AI timetable on BT LEARNING lands here. When a block starts, this phone seals itself — no willpower required. Missed sessions cost ELO.',
  },
  {
    kicker: '04  ·  Shield',
    title: 'Decide what\ngets blocked.',
    body: 'Every distracting app on your phone is listed here — the app scans the device itself. Anything switched ON is intercepted during Deep Work, protection against distractions. Switch an app OFF to keep it open for study. Phone, SMS and BT LEARNING always stay reachable.',
  },
  {
    kicker: '05  ·  During a session',
    title: 'Sealed, counted,\nhonest.',
    body: 'A counting screen runs on server time while the phone is sealed. Blocked apps bounce you back to the barrier. There IS an emergency unlock — but it voids the session, costs 25 ELO and breaks your streak.',
  },
  {
    kicker: '06  ·  Always running',
    title: 'A quiet guard\nin the corner.',
    body: 'A permanent notification keeps watch even when the app is closed, and the phone reseals itself after a restart. If your phone is a Redmi/Xiaomi, grant the battery exemption and autostart when asked — otherwise the OS kills the guard.',
  },
  {
    kicker: '07  ·  Zero tolerance',
    title: 'Cheat the clock.\nLose the streak.',
    body: 'Local time is untrusted. Durations run on server time. Force-quit, revoke permissions, or emergency-unlock and BT LEARNING deducts ELO and breaks the streak.',
  },
  {
    kicker: '08  ·  Support',
    title: 'Built by people\nyou can call.',
    body: 'BT LOCKDOWN is owned and maintained by Bongani Tatenda of BT Software Solutions. Stuck with login, a wrong lock, or a phone quirk? Call or WhatsApp +263 78 329 1237, or email bonganitatenda196@gmail.com — help is personal here.',
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
