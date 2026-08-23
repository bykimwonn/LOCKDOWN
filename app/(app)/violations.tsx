import { Card, Label, Pill } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { formatClock, formatDay } from '@/src/services/serverTime';
import { colors, fonts } from '@/src/theme';
import type { ViolationType } from '@/src/types';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const COPY: Record<ViolationType, string> = {
  force_quit: 'Force quit / background',
  permission_revoked: 'Permission revoked',
  blocked_app: 'Blocked launch',
  time_tamper: 'Clock tamper',
  emergency_unlock: 'Emergency unlock',
  accessibility_off: 'Service disabled',
  heartbeat_miss: 'Heartbeat lost',
};

export default function Violations() {
  const { violations, user } = useApp();
  const inset = useSafeAreaInsets();
  const broken = violations.filter((v) => v.streakBroken).length;
  const elo = violations.reduce((a, v) => a + v.eloDelta, 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: inset.top + 14, paddingHorizontal: 18, paddingBottom: 40 }}
    >
      <Label tone="amber">ANTI-CHEAT  ·  LEDGER</Label>
      <Text style={styles.h}>Breaches</Text>
      <View style={styles.stats}>
        <Mini k="Events" v={String(violations.length)} />
        <Mini k="ELO hit" v={String(elo)} danger />
        <Mini k="Streaks cut" v={String(broken)} danger={broken > 0} />
      </View>
      <Text style={styles.p}>
        Penalties write back to {user?.handle ?? 'your'} BT LEARNING profile. Server time is the only clock that counts.
      </Text>
      <View style={{ gap: 10 }}>
        {violations.map((v) => (
          <Card key={v.id}>
            <View style={styles.top}>
              <Pill color={v.streakBroken ? colors.crimson : colors.amber}>{COPY[v.type]}</Pill>
              <Text style={styles.when}>
                {formatDay(v.at)}  {formatClock(v.at)}
              </Text>
            </View>
            <Text style={styles.d}>{v.detail}</Text>
            <Text style={styles.pen}>
              {v.eloDelta} ELO{v.streakBroken ? '  ·  streak broken' : ''}
            </Text>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

function Mini({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <View style={styles.mini}>
      <Text style={[styles.mv, danger && { color: colors.crimson }]}>{v}</Text>
      <Label>{k}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: fonts.sansBlack, color: colors.ink, fontSize: 30, letterSpacing: -0.8, marginTop: 10 },
  p: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 14, lineHeight: 21, marginVertical: 14 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  mini: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  mv: { fontFamily: fonts.monoBold, color: colors.ink, fontSize: 18 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  when: { fontFamily: fonts.mono, color: colors.inkFaint, fontSize: 11 },
  d: { fontFamily: fonts.sans, color: colors.ink, marginTop: 10, lineHeight: 20 },
  pen: { fontFamily: fonts.monoMed, color: colors.crimson, marginTop: 10, fontSize: 12 },
});
