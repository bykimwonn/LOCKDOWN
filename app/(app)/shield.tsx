import { Card, Field, Label, Pill } from '@/src/components/ui';
import { WHITELIST } from '@/src/data/seed';
import { LockdownNative } from '@/src/services/lockdownNative';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import type { AppCategory } from '@/src/types';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CATS: { id: AppCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'social', label: 'Social' },
  { id: 'games', label: 'Games' },
  { id: 'entertainment', label: 'Watch' },
  { id: 'browsers', label: 'Web' },
  { id: 'other', label: 'Other' },
];

export default function ShieldScreen() {
  const { shield, toggleApp, importDeviceApps, lockdown } = useApp();
  const inset = useSafeAreaInsets();
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);

  // Auto-scan once when the tab opens so newly installed apps surface
  // (they were already intercepted by default-deny — this just shows them).
  // Real Android builds only; preview/web has no package manager.
  const canScan = LockdownNative.available;
  useEffect(() => {
    if (!canScan) return;
    let alive = true;
    (async () => {
      const n = await importDeviceApps().catch(() => 0);
      if (alive) setScanned((prev) => prev ?? n);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shield
      .filter((a) => (cat === 'all' ? true : a.category === cat))
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.packageId.toLowerCase().includes(q)
      );
  }, [shield, cat, query]);

  const sealedCount = shield.filter((a) => a.blocked).length;
  // Tier 1 #3: the shield is frozen for the duration of a sealed session.
  const isSealed = lockdown.active;

  const scan = async () => {
    if (scanning || isSealed) return;
    setScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const n = await importDeviceApps();
      setScanned(n);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: inset.top + 14, paddingHorizontal: 18, paddingBottom: 40 }}
    >
      <Label tone="amber">MANAGED SETTINGS</Label>
      <Text style={styles.h}>Shield list</Text>
      <Text style={styles.p}>
        {sealedCount} apps protected against distractions. During Deep Work anything ON below is
        intercepted the moment it opens. Switch an app OFF to keep it available while studying.
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

      {/* Full-device discovery: every launchable app on the phone joins the
          list, so new installs are visible (and already protected). */}
      {canScan ? (
        <Card style={styles.scanCard}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.scanT}>Detect apps on this phone</Text>
            <Text style={styles.scanP}>
              {scanned == null
                ? 'Scanning the device for installed apps…'
                : scanned > 0
                  ? `${scanned} new app${scanned === 1 ? '' : 's'} found and protected — ${shield.length} total on the shield.`
                  : `Everything on this phone is already on the shield — ${shield.length} apps protected.`}
            </Text>
          </View>
          <Pressable
            onPress={() => void scan()}
            disabled={scanning || isSealed}
            style={({ pressed }) => [
              styles.scanBtn,
              { opacity: scanning || isSealed ? 0.45 : pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.scanBtnT}>{scanning ? 'Scanning…' : 'Scan'}</Text>
          </Pressable>
        </Card>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        {CATS.map((c) => (
          <Pressable key={c.id} onPress={() => setCat(c.id)} style={[styles.cat, cat === c.id && styles.catOn]}>
            <Text style={[styles.catT, cat === c.id && { color: '#140C04' }]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {shield.length > 12 ? (
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps…"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginBottom: 12, height: 46, fontSize: 14 }}
        />
      ) : null}

      <View style={{ gap: 8 }}>
        {list.map((app) => (
          <Card key={app.id} style={styles.row}>
            <View style={styles.badge}>
              <Text style={styles.badgeT}>{app.iconHint}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{app.name}</Text>
              <Text style={styles.pkg} numberOfLines={1}>{app.packageId}</Text>
              {app.blocked ? (
                <Text style={styles.protected}>Protected against distractions</Text>
              ) : (
                <Text style={styles.open}>Open during Deep Work</Text>
              )}
            </View>
            <Switch
              value={app.blocked}
              disabled={isSealed}
              onValueChange={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                toggleApp(app.id);
              }}
              trackColor={{ false: '#2A2D36', true: colors.amber }}
              thumbColor="#fff"
            />
          </Card>
        ))}
        {list.length === 0 ? (
          <Text style={styles.empty}>No apps match this filter.</Text>
        ) : null}
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
  scanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    borderColor: colors.mint,
  },
  scanT: { fontFamily: fonts.sansBold, color: colors.mint, fontSize: 14 },
  scanP: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 12, lineHeight: 17 },
  scanBtn: {
    borderWidth: 1,
    borderColor: colors.mint,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.mintSoft,
  },
  scanBtnT: { fontFamily: fonts.sansBold, color: colors.mint, fontSize: 13 },
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
  protected: { fontFamily: fonts.sans, color: colors.mint, fontSize: 11, marginTop: 3 },
  open: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 11, marginTop: 3 },
  empty: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 18,
  },
});
