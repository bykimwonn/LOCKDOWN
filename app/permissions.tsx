import { Ambient, Body, Button, Card, Display, Label } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { Shield, Smartphone, Bell } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Permissions() {
  const { finishPermissions } = useApp();
  const inset = useSafeAreaInsets();
  const ios = Platform.OS === 'ios';

  return (
    <View style={[styles.root, { paddingTop: inset.top + 18, paddingBottom: inset.bottom + 18 }]}>
      <Ambient />
      <Label tone="amber">ENFORCEMENT LAYER</Label>
      <Display style={{ marginTop: 16 }}>Arm the{'\n'}operating system.</Display>
      <Body dim style={{ marginTop: 12, marginBottom: 24 }}>
        {ios
          ? 'Apple requires Screen Time authorization before BT LOCKDOWN can deploy shields.'
          : 'Android needs the Accessibility Service and overlay permission to intercept launches.'}
      </Body>

      <Row
        icon={<Shield color={colors.amber} size={20} />}
        title={ios ? 'Family Controls' : 'Accessibility Service'}
        body={
          ios
            ? 'ManagedSettingsStore places a system shield over social and games.'
            : 'Watches window changes. Blocked packages are sent home instantly.'
        }
      />
      <Row
        icon={<Smartphone color={colors.mint} size={20} />}
        title={ios ? 'Whitelist' : 'Display over other apps'}
        body={
          ios
            ? 'Phone, Messages, BT LEARNING and educational YouTube stay reachable.'
            : 'Full-screen return to BT LOCKDOWN if a distractor is opened.'
        }
      />
      <Row
        icon={<Bell color={colors.violet} size={20} />}
        title="Session alerts"
        body="Fired when the timetable starts Deep Work, and when a breach is scored."
      />

      <View style={{ flex: 1 }} />
      <Button title={ios ? 'Authorize Screen Time' : 'Enable lockdown service'} onPress={finishPermissions} />
      <Text style={styles.fine}>
        On this preview the permissions resolve locally. On a signed build they open the real system sheets.
      </Text>
    </View>
  );
}

function Row({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card style={{ flexDirection: 'row', gap: 14, marginBottom: 10, alignItems: 'flex-start' }}>
      <View style={styles.ic}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.t}>{title}</Text>
        <Text style={styles.b}>{body}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22 },
  ic: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  t: { fontFamily: fonts.sansSemi, color: colors.ink, fontSize: 15 },
  b: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 13, lineHeight: 19, marginTop: 3 },
  fine: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
});
