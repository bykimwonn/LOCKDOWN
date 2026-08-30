import { Button, Card, Hairline, Label, Pill } from '@/src/components/ui';
import { LockdownNative, type DeviceGuard } from '@/src/services/lockdownNative';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Settings() {
  const { user, permissions, refreshPermissionStatus, syncOk, lastSyncAt, signOut, apiBase, enforcementAvailable, linkOk } = useApp();
  const inset = useSafeAreaInsets();
  const [guard, setGuard] = useState<DeviceGuard | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const g = await LockdownNative.getDeviceGuard().catch(() => null);
      if (alive && g) setGuard(g);
    };
    read();
    const id = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dev = user?.device;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: inset.top + 14, paddingHorizontal: 18, paddingBottom: 48 }}
    >
      <Label tone="amber">BT SOFTWARE SOLUTIONS</Label>
      <Text style={styles.h}>System</Text>

      <Card style={{ marginTop: 8 }}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.sub}>{user?.email}</Text>
        <Text style={styles.sub}>
          {user?.handle}  ·  {user?.sessionsCompleted} sealed sessions  ·  {user?.minutesLocked} min
        </Text>
        {dev ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Pill color={colors.mint}>{(dev.platform || 'device').toUpperCase()}</Pill>
            <Text style={styles.sub}>
              linked device {String(dev.device_id || '').slice(0, 8)}…
            </Text>
          </View>
        ) : null}
      </Card>

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Sync bridge</Label>
      <Card>
        <View style={[styles.linkRow, { borderColor: linkOk ? colors.mint : colors.crimson }]}>
          <View style={[styles.linkDot, { backgroundColor: linkOk ? colors.mint : colors.crimson }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkT}>BT LEARNING ↔ BT LOCKDOWN</Text>
            <Text style={styles.linkS}>
              {linkOk
                ? 'Strong link — timetables, penalties and lockouts sync live.'
                : 'Link interrupted — the app will still hold its own seal and re-sync when the server is reachable.'}
            </Text>
          </View>
        </View>
        <Hairline />
        <Row k="Last flag" v={lastSyncAt ? lastSyncAt.slice(11, 19) + 'Z' : '—'} />
        <Hairline />
        <Row k="Clock authority" v="Server time only" />
        <Hairline />
        <Row k="Auto-lock" v="On AI timetable" />
        <Hairline />
        <Row k="Native module" v={LockdownNative.available ? 'Linked' : 'JS fallback'} />
      </Card>

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Enforcement</Label>
      <Card>
        <Row
          k="Platform"
          v={
            Platform.OS === 'ios'
              ? 'iOS — not supported yet'
              : Platform.OS === 'android'
                ? 'Android Accessibility'
                : 'Preview'
          }
        />
        <Hairline />
        <Row
          k="Accessibility"
          v={permissions.accessibility}
          onPress={() => LockdownNative.requestAccessibility().then(() => void refreshPermissionStatus()).catch(() => undefined)}
        />
        <Hairline />
        <Row
          k="Overlay barrier"
          v={permissions.overlay}
          onPress={() => LockdownNative.requestOverlay().then(() => void refreshPermissionStatus()).catch(() => undefined)}
        />
        <Hairline />
        <Row k="Battery exemption" v={guard?.battery ?? '—'} onPress={() => LockdownNative.requestBatteryExemption().then(() => void refreshPermissionStatus()).catch(() => undefined)} />
        <Hairline />
        <Row
          k="Device admin"
          v={guard?.admin ?? '—'}
          onPress={() => LockdownNative.requestDeviceAdmin().then(() => void refreshPermissionStatus()).catch(() => undefined)}
        />
        {guard?.miui === 'detected' ? (
          <>
            <Hairline />
            <Row k="Device" v="Xiaomi / Redmi — lock in recents" />
          </>
        ) : null}
      </Card>

      {!enforcementAvailable ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={styles.warn}>
            {Platform.OS === 'ios'
              ? 'iOS enforcement is not wired in this build. The app syncs with BT LEARNING but cannot intercept other apps.'
              : 'Enforcement is not linked (Expo Go / preview build). Build the APK to seal this device.'}
          </Text>
        </Card>
      ) : null}

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Suite</Label>
      <Card>
        <Row k="Product" v="BT LOCKDOWN 1.0.0" />
        <Hairline />
        <Row k="Sibling" v="BT LEARNING" />
        <Hairline />
        <Row k="House" v="BT Software Solutions" />
      </Card>

      <Button title="Sign out of this device" variant="ghost" onPress={signOut} style={{ marginTop: 22 }} />
    </ScrollView>
  );
}

function Row({ k, v, onPress }: { k: string; v: string; onPress?: () => void }) {
  if (onPress) {
    return (
      <View style={styles.row}>
        <Text style={styles.k}>{k}</Text>
        <Text style={[styles.v, styles.link]} onPress={onPress}>
          {v} ›
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: fonts.sansBlack, color: colors.ink, fontSize: 30, letterSpacing: -0.8, marginTop: 10, marginBottom: 14 },
  name: { fontFamily: fonts.sansBold, color: colors.ink, fontSize: 20 },
  sub: { fontFamily: fonts.sans, color: colors.inkMute, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, gap: 12 },
  k: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 14 },
  v: { fontFamily: fonts.sansMed, color: colors.ink, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  link: { color: colors.amber },
  warn: { fontFamily: fonts.sans, color: colors.crimson, fontSize: 13, lineHeight: 19 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  linkDot: { width: 14, height: 14, borderRadius: 7 },
  linkT: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 14 },
  linkS: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 12, lineHeight: 18, marginTop: 2 },
});
