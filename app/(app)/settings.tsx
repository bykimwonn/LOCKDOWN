import { Button, Card, Hairline, Label } from '@/src/components/ui';
import { LockdownNative } from '@/src/services/lockdownNative';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Settings() {
  const { user, permissions, syncOk, lastSyncAt, signOut, apiBase } = useApp();
  const inset = useSafeAreaInsets();

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
        <Text style={styles.sub}>{user?.handle}  ·  {user?.sessionsCompleted} sealed sessions</Text>
      </Card>

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Sync bridge</Label>
      <Card>
        <Row k="BT LEARNING" v={syncOk ? 'Live' : 'Unreachable'} />
        <Hairline />
        <Row k="API" v={apiBase || 'not set'} />
        <Hairline />
        <Row k="Last flag" v={lastSyncAt ? lastSyncAt.slice(11, 19) + 'Z' : '—'} />
        <Hairline />
        <Row k="Clock authority" v="Server time only" />
        <Hairline />
        <Row k="Native module" v={LockdownNative.available ? 'Linked' : 'JS fallback'} />
      </Card>

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Enforcement</Label>
      <Card>
        <Row k="Platform" v={Platform.OS === 'ios' ? 'iOS Family Controls' : Platform.OS === 'android' ? 'Android Accessibility' : 'Preview'} />
        <Hairline />
        <Row k="Screen Time" v={permissions.screenTime} />
        <Hairline />
        <Row k="Accessibility" v={permissions.accessibility} />
        <Hairline />
        <Row k="Overlay" v={permissions.overlay} />
      </Card>

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

function Row({ k, v }: { k: string; v: string }) {
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
});
