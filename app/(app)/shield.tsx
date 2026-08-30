import { Card, Label, Pill } from '@/src/components/ui';
import { WHITELIST } from '@/src/data/seed';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import type { AppCategory } from '@/src/types';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CATS: { id: AppCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'social', label: 'Social' },
  { id: 'games', label: 'Games' },
  { id: 'entertainment', label: 'Watch' },
  { id: 'browsers', label: 'Web' },
];

export default function ShieldScreen() {
  const { shield, toggleApp, lockdown } = useApp();
  const inset = useSafeAreaInsets();
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('all');
  const list = useMemo(
    () => (cat === 'all' ? shield : shield.filter((a) => a.category === cat)),
    [shield, cat]
  );
  const sealed = shield.filter((a) => a.blocked).length;
  // Tier 1 #3: the shield is frozen for the duration of a sealed session.
  const isSealed = lockdown.active;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: inset.top + 14, paddingHorizontal: 18, paddingBottom: 40 }}
    >
      <Label tone="amber">MANAGED SETTINGS</Label>
      <Text style={styles.h}>Shield list</Text>
      <Text style={styles.p}>
        {sealed} apps sealed. Essential tools stay reachable. Everything else is intercepted the moment it opens.
      </Text>
      {isSealed && (
        <Card style={styles.lockedBanner}>
          <Text style={styles.lockedT}>🔒 Shield locked during Deep Work</Text>
          <Text style={styles.lockedP}>
            Changes to the sealed-app list apply from your next session. The shield cannot be
            weakened while a session is running.
          </Text>
        </Card>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        {CATS.map((c) => (
          <Pressable key={c.id} onPress={() => setCat(c.id)} style={[styles.cat, cat === c.id && styles.catOn]}>
            <Text style={[styles.catT, cat === c.id && { color: '#140C04' }]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ gap: 8 }}>
        {list.map((app) => (
          <Card key={app.id} style={styles.row}>
            <View style={styles.badge}>
              <Text style={styles.badgeT}>{app.iconHint}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{app.name}</Text>
              <Text style={styles.pkg}>{app.packageId}</Text>
            </View>
            <Switch
              value={app.blocked}
              disabled={isSealed}
              onValueChange={() => toggleApp(app.id)}
              trackColor={{ false: '#2A2D36', true: colors.amber }}
              thumbColor="#fff"
            />
          </Card>
        ))}
      </View>
      <Label style={{ marginTop: 22, marginBottom: 10 }}>Whitelist</Label>
      {WHITELIST.map((w) => (
        <Card key={w.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.pkg}>{w.reason}</Text>
          </View>
          {w.essential ? <Pill color={colors.mint}>Essential</Pill> : <Pill color={colors.violet}>Allowed</Pill>}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: fonts.sansBlack, color: colors.ink, fontSize: 30, letterSpacing: -0.8, marginTop: 10 },
  p: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 14, lineHeight: 21, marginVertical: 12 },
  cats: { gap: 8, marginBottom: 14 },
  cat: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  catOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  catT: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 13 },
  lockedBanner: { borderColor: colors.amber, borderWidth: 1, marginBottom: 14, gap: 4 },
  lockedT: { fontFamily: fonts.sansBold, color: colors.amber, fontSize: 14 },
  lockedP: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeT: { fontFamily: fonts.sansBold, color: colors.inkMute, fontSize: 12 },
  name: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 15 },
  pkg: { fontFamily: fonts.mono, color: colors.inkFaint, fontSize: 11, marginTop: 2 },
});
