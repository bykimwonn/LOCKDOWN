import { Ambient, Body, Button, Card, Display, Label, Pill } from '@/src/components/ui';
import { LockdownNative, type DeviceGuard } from '@/src/services/lockdownNative';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { Bell, Shield, Smartphone, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Permissions() {
  const { finishPermissions, refreshPermissionStatus, requestBatteryExemption, enforcementAvailable } = useApp();
  const inset = useSafeAreaInsets();
  const ios = Platform.OS === 'ios';
  const [guard, setGuard] = useState<DeviceGuard | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ios) return;
    let alive = true;
    const read = async () => {
      const g = await LockdownNative.getDeviceGuard().catch(() => null);
      if (alive && g) setGuard(g);
    };
    read();
    const id = setInterval(read, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ios]);

  const go = async () => {
    setBusy(true);
    try {
      await finishPermissions();
    } finally {
      setBusy(false);
    }
  };

  const a11yOk = guard?.accessibility === 'granted';
  const overlayOk = guard?.overlay === 'granted';
  const batteryOk = guard?.battery === 'granted';

  return (
    <View style={[styles.root, { paddingTop: inset.top + 18, paddingBottom: inset.bottom + 18 }]}>
      <Ambient />
      <Label tone="amber">ENFORCEMENT LAYER</Label>
      <Display style={{ marginTop: 16 }}>
        {ios ? 'iOS is not\nsupported yet.' : 'Arm the\noperating system.'}
      </Display>
      <Body dim style={{ marginTop: 12, marginBottom: 22 }}>
        {ios
          ? 'BT LOCKDOWN currently seals Android devices. On iPhone the app syncs with BT LEARNING, but it cannot intercept other apps — enforcement requires the Apple Family Controls build, which is in progress. Use an Android phone for lockdown.'
          : 'Grant the system access below. On Xiaomi / Redmi, also allow BT LOCKDOWN to start on boot and ignore battery savings, or Android will quietly kill the lockdown.'}
      </Body>

      {ios ? (
        <Card>
          <Row
            icon={<Shield color={colors.crimson} size={20} />}
            title="App interception"
            body="Not available on this iOS build."
            ok={false}
          />
        </Card>
      ) : (
        <>
          <Card>
            <Row
              icon={<Shield color={colors.amber} size={20} />}
              title="Accessibility service"
              body="Watches app switches. Blocked apps are intercepted instantly."
              ok={a11yOk}
            />
            <Row
              icon={<Smartphone color={colors.mint} size={20} />}
              title="Display over other apps"
              body="Full-screen sealed barrier when a distractor is opened."
              ok={overlayOk}
            />
          </Card>

          <Card style={{ marginTop: 10 }}>
            <Row
              icon={<Bell color={colors.violet} size={20} />}
              title="Session alerts"
              body="Full-screen alert when Deep Work starts, even if the phone is in the background."
              ok={false}
            />
            <Row
              icon={<Zap color={colors.crimson} size={20} />}
              title="Battery optimization off"
              body="Required on Redmi / MIUI, or the process gets killed and the seal drops."
              ok={batteryOk}
              onPress={requestBatteryExemption}
            />
            {guard?.miui === 'detected' ? (
              <Row
                icon={<Smartphone color={colors.amber} size={20} />}
                title="MIUI autostart"
                body="The button below opens it. Allow BT LOCKDOWN, then lock it in recents."
                ok={false}
                onPress={() => LockdownNative.openAutostartSettings().catch(() => undefined)}
              />
            ) : null}
          </Card>

          <Body dim style={{ marginTop: 10, marginBottom: 18 }}>
            Last step: swipe up on the home screen, open recent apps, and press the lock icon on
            BT LOCKDOWN. This keeps the watchdog alive even when you are studying.
          </Body>
        </>
      )}

      <View style={{ flex: 1 }} />
      {!ios && !enforcementAvailable ? (
        <Card style={{ marginBottom: 12, borderColor: colors.crimson }}>
          <Text style={styles.warnT}>
            Running in Expo Go / preview: enforcement is simulated and will not block apps.
            Build a real APK from this repo to seal the device.
          </Text>
        </Card>
      ) : null}
      {!ios && a11yOk && overlayOk && (
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <Pill color={colors.mint}>
            CORE PROTECTION ARMED{batteryOk ? '' : '  ·  BATTERY NOT EXEMPT'}
          </Pill>
        </View>
      )}
      <Button
        title={ios ? 'Continue (sync only)' : busy ? 'Arming…' : 'Enter BT LOCKDOWN'}
        onPress={go}
        disabled={busy}
      />
      {!ios && !a11yOk ? (
        <Text style={styles.fine}>
          Without the accessibility service the phone can sync with BT LEARNING but cannot block
          apps. You can enter now and come back from the System tab.
        </Text>
      ) : null}
    </View>
  );
}

function Row({
  icon,
  title,
  body,
  ok,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ok?: boolean;
  onPress?: () => void;
}) {
  return (
    <Card style={{ flexDirection: 'row', gap: 14, marginBottom: 10, alignItems: 'flex-start' }}>
      <View style={styles.ic}>{icon}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.t}>{title}</Text>
          {ok ? <Pill color={colors.mint}>ON</Pill> : null}
        </View>
        <Text style={styles.b}>{body}</Text>
        {onPress && !ok ? (
          <Text style={styles.link} onPress={onPress}>
            Open settings ›
          </Text>
        ) : null}
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
  link: { fontFamily: fonts.sansSemi, color: colors.amber, fontSize: 13, marginTop: 8 },
  warnT: { fontFamily: fonts.sans, color: colors.crimson, fontSize: 13, lineHeight: 19 },
  fine: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
});
