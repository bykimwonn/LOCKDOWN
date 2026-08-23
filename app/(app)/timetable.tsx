import { Card, Label, Pill } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { formatClock } from '@/src/services/serverTime';
import { colors, fonts } from '@/src/theme';
import type { DeepWorkSession } from '@/src/types';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TONE: Record<string, string> = {
  scheduled: colors.violet,
  active: colors.amber,
  completed: colors.mint,
  failed: colors.crimson,
  abandoned: colors.inkFaint,
};

export default function Timetable() {
  const { sessions } = useApp();
  const inset = useSafeAreaInsets();
  const ordered = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: inset.top + 14, paddingHorizontal: 18, paddingBottom: 40 }}
    >
      <Label tone="amber">BT LEARNING  ·  AI TIMETABLE</Label>
      <Text style={styles.h}>Today’s Deep Work</Text>
      <Text style={styles.p}>
        Pulled live from your BT LEARNING account. When a block is in progress the phone seals itself.
      </Text>
      {ordered.length === 0 ? (
        <Text style={styles.p}>
          No study blocks on the server. On the website, build your AI timetable (independent) or ask admin to set study hours (school).
        </Text>
      ) : (
        <View style={{ gap: 10, marginTop: 8 }}>
          {ordered.map((s, i) => (
            <Block key={s.id} session={s} last={i === ordered.length - 1} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Block({ session, last }: { session: DeepWorkSession; last: boolean }) {
  const color = TONE[session.status] ?? colors.inkMute;
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        {!last ? <View style={styles.line} /> : null}
      </View>
      <Card style={{ flex: 1, marginBottom: 4 }}>
        <View style={styles.top}>
          <Label>{formatClock(session.startsAt)} – {formatClock(session.endsAt)}</Label>
          <Pill color={color}>{session.status}</Pill>
        </View>
        <Text style={styles.title}>{session.title}</Text>
        <Text style={styles.sub}>
          {session.subject}  ·  {session.source === 'timetable' ? 'AI timetable' : 'manual'}
        </Text>
        {session.focusNote ? <Text style={styles.note}>{session.focusNote}</Text> : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: fonts.sansBlack, color: colors.ink, fontSize: 30, letterSpacing: -0.8, marginTop: 10 },
  p: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 14, lineHeight: 21, marginVertical: 12 },
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 10, marginTop: 22 },
  line: { width: 1, flex: 1, backgroundColor: colors.lineStrong, marginTop: 6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 16, marginTop: 8 },
  sub: { fontFamily: fonts.sans, color: colors.inkMute, marginTop: 4, fontSize: 13 },
  note: { fontFamily: fonts.sans, color: colors.ink, marginTop: 8, fontSize: 13 },
});
