import { Ambient, Body, Button, Card, Display, Label, Pill } from '@/src/components/ui';
import { invalidateDeviceGuard, LockdownNative, type DeviceGuard } from '@/src/services/lockdownNative';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { Bell, Shield, Smartphone, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Permissions() {
  const {
    finishPermissions,
    refreshPermissionStatus,
    requestBatteryExemption,
    enforcementAvailable,
    setupDone,
  } = useApp();
  const inset = useSafeAreaInsets();
  const ios = Platform.OS === 'ios';
  const [guard, setGuard] = useState<DeviceGuard | null>(null);
  const [busy, setBusy] = useState(false);
  const [samsung, setSamsung] = useState(false);

  // Reading the guard state means 3 system queries (Settings.Secure, AccessibilityManager,
  // NotificationManager). This screen used to poll them every 2.5 s forever, which is
  // exactly the sort of main-thread traffic that makes a screen like this feel sticky —
  // and it was pointless once everything was already granted. Now: read on mount, read
  // again when the app comes back to the foreground (that is the moment the student
  // returns from system Settings), and poll fast only while a grant request is running.
  const readGuard = useCallback(async () => {
    const g = await LockdownNative.getDeviceGuard(true).catch(() => null);
    if (g) setGuard(g);
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    if (ios) return;
    readGuard().catch(() => undefined);
    LockdownNative.isSamsungDevice()
      .then((v) => v && setSamsung(true))
      .catch(() => undefined);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') readGuard().catch(() => undefined);
    });
    return () => sub.remove();
  }, [ios, readGuard]);

  useEffect(() => {
    if (ios || !busy) return;
    const id = setInterval(() => {
      LockdownNative.getDeviceGuard(true)
        .then(setGuard)
        .catch(() => undefined);
    }, 1200);
    return () => clearInterval(id);
  }, [ios, busy]);

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
      <Label tone="amber">{setupDone ? 'ENFORCEMENT LAYER · RE-ARM' : 'ENFORCEMENT LAYER · ONE-TIME SETUP'}</Label>
      <Display style={{ marginTop: 16 }}>
        {ios ? 'iOS is not\nsupported yet.' : 'Arm the\noperating system.'}
      </Display>
      <Body dim style={{ marginTop: 12, marginBottom: 22 }}>
        {ios
          ? 'BT LOCKDOWN currently seals Android devices. On iPhone the app syncs with BT LEARNING, but it cannot intercept other apps — enforcement requires the Apple Family Controls build, which is in progress. Use an Android phone for lockdown.'
          : 'Grant the system access below. Also stop the OS from killing BT LOCKDOWN in the background — every OEM (Samsung, Xiaomi, Huawei, Oppo, Vivo) hides this in a different menu, so a one-tap button below opens the right screen for your phone.'}
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
              body="Watches app switches. Blocked apps are intercepted instantly. Tap to open settings, then switch BT LOCKDOWN ON."
              ok={a11yOk}
              onPress={() => LockdownNative.requestAccessibility().then(() => { invalidateDeviceGuard(); return void refreshPermissionStatus(); }).catch(() => undefined)}
            />
            <Row
              icon={<Smartphone color={colors.mint} size={20} />}
              title="Display over other apps"
              body="Full-screen sealed barrier when a distractor is opened. Tap to allow."
              ok={overlayOk}
              onPress={() => LockdownNative.requestOverlay().then(() => { invalidateDeviceGuard(); return void refreshPermissionStatus(); }).catch(() => undefined)}
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
            <Row
              icon={<Shield color={colors.crimson} size={20} />}
              title="Device admin (phone admin)"
              body="Prevents the seal being removed or the app uninstalled mid-session. Optional — tap to grant if you want tamper protection."
              ok={guard?.admin === 'granted'}
              onPress={() => LockdownNative.requestDeviceAdmin().then(() => { invalidateDeviceGuard(); return void refreshPermissionStatus(); }).catch(() => undefined)}
            />
            {guard?.miui === 'detected' || samsung ? (
              <Row
                icon={<Smartphone color={colors.amber} size={20} />}
                title={samsung ? 'Samsung background access' : 'MIUI autostart'}
                body={
                  samsung
                    ? 'One UI sleeps apps aggressively. Tap to open Battery → Background usage limits, allow BT LOCKDOWN, then set it as "Unmonitored".'
                    : 'The button below opens it. Allow BT LOCKDOWN, then lock it in recents.'
                }
                ok={false}
                onPress={() => LockdownNative.openAutostartSettings().catch(() => undefined)}
              />
            ) : null}
          </Card>

          <Body dim style={{ marginTop: 10, marginBottom: 18 }}>
            Last step: open recent apps and press the lock icon on BT LOCKDOWN. This keeps the
            watchdog alive even when you are studying — and stops the OS killing it mid-session.
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
        title={
          ios
            ? 'Continue (sync only)'
            : busy
              ? 'Arming…'
              : a11yOk && overlayOk
                ? 'Enter BT LOCKDOWN'
                : a11yOk
                  ? 'Grant overlay to continue'
                  : 'Enable Accessibility to continue'
        }
        onPress={go}
        disabled={busy}
      />
      {!ios && !a11yOk ? (
        <Card style={{ marginTop: 12, borderColor: colors.crimson }}>
          <Text style={styles.fine}>
            You cannot enter until the Accessibility service is ON. This is the only thing that
            actually intercepts distracting apps — without it the phone syncs with BT LEARNING but
            cannot seal itself.
          </Text>
          <Text
            style={styles.linkLine}
            onPress={() => {
              setBusy(true);
              LockdownNative.requestAccessibility()
                .then(() => void refreshPermissionStatus())
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            Open Accessibility settings ›
          </Text>
        </Card>
      ) : null}
      {!ios && a11yOk && !overlayOk ? (
        <Card style={{ marginTop: 12, borderColor: colors.crimson }}>
          <Text style={styles.fine}>
            One more step: allow BT LOCKDOWN to display over other apps. That Permission is what
            draws the full-screen seal over a blocked app.
          </Text>
          <Text
            style={styles.linkLine}
            onPress={() => {
              setBusy(true);
              LockdownNative.requestOverlay()
                .then(() => void refreshPermissionStatus())
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            Open Overlay settings ›
          </Text>
        </Card>
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
    color: colors.inkMute,
    fontSize: 13,
    lineHeight: 20,
  },
  linkLine: {
    fontFamily: fonts.sansSemi,
    color: colors.amber,
    fontSize: 14,
    marginTop: 8,
  },
});
