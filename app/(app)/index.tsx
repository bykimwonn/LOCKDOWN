import { AttentionBanner } from '@/src/components/AttentionBanner';
import { RefreshButton } from '@/src/components/RefreshButton';
import { StatusRing } from '@/src/components/StatusRing';
import { Button, Card, Label, Mono, Pill } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { formatClock, formatRemain, serverNow } from '@/src/services/serverTime';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Command() {
  const { user, sessions, lockdown, syncOk, lastSyncAt, startManualFocus, linkOk } = useApp();
  const inset = useSafeAreaInsets();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const next = useMemo(() => {
    const now = serverNow().getTime();
    return [...sessions]
      .filter((s) => Date.parse(s.endsAt) > now && s.status !== 'abandoned' && s.status !== 'failed')
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  }, [sessions]);

  const until = next ? Date.parse(next.startsAt) - serverNow().getTime() : 0;
  const inSession = next && Date.parse(next.startsAt) <= serverNow().getTime();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: inset.top + 12, paddingBottom: 40, paddingHorizontal: 18 }}
    >
      <View style={styles.head}>
        <View>
          <Label tone="amber">BT LOCKDOWN</Label>
          <Text style={styles.hi}>{user?.name?.split(' ')[0] ?? 'Student'}</Text>
        </View>
        <View style={styles.headRight}>
          {/* Refresh the entire app: reconnect to BT LEARNING, re-pull
              sessions + profile, re-check permissions and the native seal. */}
          <RefreshButton />
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Pill color={linkOk ? colors.mint : colors.crimson}>
              {linkOk ? '● LINKED' : '● OFFLINE'}
            </Pill>
            <Pill color={syncOk ? colors.mint : colors.crimson}>
              {syncOk ? 'SYNC LIVE' : 'SYNC DOWN'}
            </Pill>
          </View>
        </View>
      </View>

      {/* After first-run setup a dead grant is a strip here + a system notification,
          never a screen the app drags you to. Policy: src/services/attention.ts. */}
      <AttentionBanner />

      <View style={styles.ringWrap}>
        <StatusRing
          progress={inSession ? 0.18 : next ? Math.max(0.05, 1 - until / (1000 * 60 * 60 * 8)) : 0}
          label={inSession ? 'Deep Work' : 'Standing by'}
          value={next ? (inSession ? 'NOW' : formatRemain(until)) : '--:--'}
          sub={next ? next.title : 'No session on the board'}
          tone={inSession ? 'amber' : 'idle'}
        />
      </View>

      <View style={styles.stats}>
        <Stat k="ELO" v={String(user?.elo ?? 0)} c={colors.violet} />
        <Stat k="Streak" v={`${user?.streak ?? 0}d`} c={colors.amber} />
        <Stat k="Sealed" v={`${user?.minutesLocked ?? 0}m`} c={colors.mint} />
      </View>

      {next ? (
        <Card style={{ marginTop: 16 }}>
          <Label>Next block</Label>
          <Text style={styles.cardT}>{next.title}</Text>
          <Text style={styles.cardB}>
            {formatClock(next.startsAt)} – {formatClock(next.endsAt)}  ·  {next.subject}
          </Text>
          {next.focusNote ? <Text style={styles.note}>{next.focusNote}</Text> : null}
        </Card>
      ) : null}

      <View style={{ marginTop: 18, gap: 10 }}>
        <Button
          title="Start 50-minute focus"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
            startManualFocus(50, 'Manual Deep Work · 50');
          }}
        />
        <Button
          title="Start 25-minute sprint"
          variant="ghost"
          onPress={() => startManualFocus(25, 'Manual sprint · 25')}
        />
      </View>

      <View style={styles.foot}>
        <Mono size={11} style={{ color: colors.inkFaint }}>
          last flag  {lastSyncAt ? formatClock(lastSyncAt) : '—'}   ·   armed {lockdown.armedBy}
        </Mono>
      </View>
    </ScrollView>
  );
}

function Stat({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statV, { color: c }]}>{v}</Text>
      <Label>{k}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headRight: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hi: { fontFamily: fonts.sansBold, color: colors.ink, fontSize: 26, marginTop: 4 },
  ringWrap: { alignItems: 'center', marginVertical: 10 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  statV: { fontFamily: fonts.monoBold, fontSize: 18 },
  cardT: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 17, marginTop: 8 },
  cardB: { fontFamily: fonts.sans, color: colors.inkMute, marginTop: 4 },
  note: { fontFamily: fonts.sans, color: colors.ink, marginTop: 10, fontSize: 13 },
  foot: { marginTop: 22, alignItems: 'center' },
});
