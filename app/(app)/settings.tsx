import { Button, Card, Hairline, Label, Pill } from '@/src/components/ui';
import { SUPPORT } from '@/src/constants/support';
import { LockdownNative, type DeviceGuard } from '@/src/services/lockdownNative';
import { formatDuration, modeLabel, summarizeProtection, type ShieldMode } from '@/src/services/protection';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Settings() {
  const {
    user, permissions, refreshPermissionStatus, syncOk, lastSyncAt, signOut, apiBase,
    enforcementAvailable, linkOk, refreshApp, refreshing, protection, refreshProtection,
    setNetworkShield, requestNetworkShieldConsent, grantNetworkBreak, releaseNetworkShield,
    setAccessibilityAllowlist, openSealSettings,
  } = useApp();
  const inset = useSafeAreaInsets();
  const [guard, setGuard] = useState<DeviceGuard | null>(null);
  /** Mode chosen in the UI but not armed yet — arming needs the consent tap. */
  const [pendingMode, setPendingMode] = useState<ShieldMode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const g = await LockdownNative.getDeviceGuard().catch(() => null);
      if (alive && g) setGuard(g);
      void refreshProtection();
    };
    read();
    const id = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refreshProtection]);

  const summary = summarizeProtection(protection, guard);
  const tone =
    summary.tone === 'mint' ? colors.mint : summary.tone === 'crimson' ? colors.crimson : summary.tone === 'amber' ? colors.amber : colors.inkMute;

  const arm = async (mode: ShieldMode, consent: boolean) => {
    setBusy(true);
    try {
      await setNetworkShield(mode, consent, Boolean(protection?.lockVpnUi));
      setPendingMode(null);
    } finally {
      setBusy(false);
    }
  };

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

      <Label style={{ marginTop: 22, marginBottom: 10 }}>About</Label>
      <Card>
        <Row k="Name" v={user?.name ?? '—'} />
        <Hairline />
        <Row k="Email" v={user?.email ?? '—'} />
        <Hairline />
        <Row k="Handle" v={user?.handle ?? '—'} />
        <Hairline />
        <Row k="Student ID" v={user?.studentId ?? '—'} />
        <Hairline />
        <Row k="Role" v={user?.role ?? 'Student'} />
        <Hairline />
        <Row k="Account ID" v={user?.id ?? '—'} />
        <Hairline />
        <Row k="ELO" v={user ? String(user.elo) : '—'} />
        <Hairline />
        <Row k="Current streak" v={user ? `${user.streak} day${user.streak === 1 ? '' : 's'}` : '—'} />
        <Hairline />
        <Row k="Longest streak" v={user ? `${user.longestStreak} day${user.longestStreak === 1 ? '' : 's'}` : '—'} />
        <Hairline />
        <Row k="Sealed sessions" v={user ? String(user.sessionsCompleted) : '—'} />
        <Hairline />
        <Row k="Minutes locked" v={user ? String(user.minutesLocked) : '—'} />
        <Hairline />
        <Row k="Device" v={dev ? `${(dev.platform || 'device').toUpperCase()} ${String(dev.device_id || '').slice(0, 8)}…` : 'Not bound'} />
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
      <Button
        title={refreshing ? 'Refreshing app…' : 'Refresh app now'}
        variant="ghost"
        style={{ marginTop: 12 }}
        disabled={refreshing}
        onPress={() => {
          void refreshApp();
        }}
      />

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

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Network shield · protection</Label>
      <Card>
        <View style={[styles.linkRow, { borderColor: tone }]}>
          <View style={[styles.linkDot, { backgroundColor: tone }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkT}>{summary.headline.toUpperCase()}</Text>
            <Text style={styles.linkS}>{summary.detail}</Text>
          </View>
        </View>
        <Hairline />
        <Row k="Layer 1 · app launches" v={sealLabel(protection)} onPress={() => void openSealSettings()} />
        <Hairline />
        <Row k="Layer 2 · internet" v={protection?.statusLine ?? 'unavailable'} />
        <Hairline />
        <Row k="Always-on tunnel" v={protection?.alwaysOnVpn ? 'Owned by Android (survives force-stop)' : 'Device owner only'} />
        <Hairline />
        <Row k="Captured apps" v={protection ? (protection.mode === 'strict' ? 'everything except BT LOCKDOWN' : `${protection.capturedApps} shielded`) : '—'} />
        <Hairline />
        <Row k="Blocked for" v={protection && protection.blockedForSeconds > 0 ? `${formatDuration(protection.blockedForSeconds)} / cap ${formatDuration(protection.ceilingSeconds)}` : '—'} />
        <Hairline />
        <Row k="Sync path" v={protection ? (protection.controlChannelOk ? 'BT LEARNING reachable' : 'no accepted heartbeat 150 s') : '—'} />
        <Hairline />
        <Row k="Seal drops / restores" v={protection?.seal ? `${protection.seal.dropCount} / ${protection.seal.restoreCount}` : '—'} />
        <Hairline />
        <Row k="Shield disconnects" v={protection ? String(protection.revokeCount) : '—'} />
        {protection?.seal?.lastDropWhy ? (
          <>
            <Hairline />
            <Row k="Last seal loss" v={protection.seal.lastDropWhy.replace(/_/g, ' ')} />
          </>
        ) : null}
      </Card>

      {summary.needsConsent || pendingMode ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={styles.linkT}>What the network shield does</Text>
          <Text style={styles.linkS}>
            During a Deep Work session BT LOCKDOWN opens a local VPN that drops the
            device&apos;s Internet for {pendingMode === 'strict' || protection?.mode === 'strict' ? 'every app except BT LOCKDOWN' : 'the apps on your shield list'}
            , so social media stays unreachable even if the accessibility seal is
            switched off or killed by the phone. Android shows its own VPN icon and
            dialog for this — nothing is hidden. BT LOCKDOWN keeps its own
            connection to BT LEARNING so your teacher can still end the session, and
            the block is released automatically when the session ends, on a break, or
            after the {protection ? Math.round(protection.ceilingSeconds / 3600) : 8}-hour safety ceiling.
          </Text>
          <Button
            title="Accept and arm the shield"
            variant="mint"
            style={{ marginTop: 12 }}
            disabled={busy}
            onPress={() => void arm(pendingMode ?? protection?.mode ?? 'apps', true)}
          />
          <Button
            title="Ask Android for the VPN allowance"
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={() => void requestNetworkShieldConsent()}
          />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Button
          title="Off"
          variant={protection?.mode === 'off' || !protection ? 'mint' : 'ghost'}
          style={{ flex: 1 }}
          disabled={busy}
          onPress={() => void arm('off', false)}
        />
        <Button
          title="Shield apps"
          variant={protection?.mode === 'apps' ? 'mint' : 'ghost'}
          style={{ flex: 1 }}
          disabled={busy}
          onPress={() => (protection?.consent ? void arm('apps', true) : setPendingMode('apps'))}
        />
        <Button
          title="Strict"
          variant={protection?.mode === 'strict' ? 'mint' : 'ghost'}
          style={{ flex: 1 }}
          disabled={busy}
          onPress={() => (protection?.consent ? void arm('strict', true) : setPendingMode('strict'))}
        />
      </View>
      <Text style={[styles.sub, { marginTop: 8 }]}>
        {protection ? modeLabel(protection.mode) : 'No native layer in this build.'}
        {protection?.sealed ? ' · armed while a session is sealed' : ''}
      </Text>

      {summary.action === 'break' && protection ? (
        <Button
          title={`Grant ${Math.min(5, protection.breakMinutesCap)}-min internet break (${protection.breaksCap - protection.breakCount} left)`}
          variant="ghost"
          style={{ marginTop: 12 }}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void grantNetworkBreak(Math.min(5, protection.breakMinutesCap)).finally(() => setBusy(false));
          }}
        />
      ) : null}
      {summary.action === 're-enable-seal' ? (
        <Button
          title="Re-enable the seal service"
          variant="danger"
          style={{ marginTop: 12 }}
          onPress={() => void openSealSettings()}
        />
      ) : null}
      {summary.canRelease && !protection?.sealed ? (
        <Button
          title="Release the network shield"
          variant="ghost"
          style={{ marginTop: 12 }}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void releaseNetworkShield().finally(() => setBusy(false));
          }}
        />
      ) : null}
      {protection?.sealGuidance && !protection.seal?.enforcing && protection.sealed ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={styles.warn}>Seal layer: {protection.sealGuidance}</Text>
          <Hairline />
          <Row k="Battery exemption" v={guard?.battery ?? '—'} onPress={() => void LockdownNative.requestBatteryExemption().then(() => refreshProtection()).catch(() => undefined)} />
          <Hairline />
          <Row k="Autostart (OEM)" v="Open ›" onPress={() => void LockdownNative.openAutostartSettings().catch(() => undefined)} />
        </Card>
      ) : null}

      {guard?.owner === 'granted' ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.linkT}>DEVICE-OWNER POLICY</Text>
          <Text style={styles.linkS}>
            These are managed by the school, not the student: Android keeps the
            always-on tunnel up across reboot and blocks traffic while it is down,
            and the VPN/automation settings can be locked. Turn them on deliberately
            — they change what the student can reach in Settings.
          </Text>
          <Hairline />
          <Row
            k="Hide Settings → VPN while sealed"
            v={protection?.lockVpnUi ? 'On' : 'Off'}
            onPress={() => {
              const next = !protection?.lockVpnUi;
              void setNetworkShield(protection?.mode === 'strict' ? 'strict' : 'apps', true, next);
            }}
          />
          <Hairline />
          <Row
            k="No other accessibility service"
            v="Apply ›"
            onPress={() => void setAccessibilityAllowlist(true)}
          />
        </Card>
      ) : null}

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Device owner · kiosk</Label>
      <Card>
        <View style={[styles.linkRow, { borderColor: guard?.owner === 'granted' ? colors.mint : colors.crimson }]}>
          <View style={[styles.linkDot, { backgroundColor: guard?.owner === 'granted' ? colors.mint : colors.crimson }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkT}>DEVICE OWNER {guard?.owner === 'granted' ? '· ACTIVE' : '· NOT SET'}</Text>
            <Text style={styles.linkS}>
              {guard?.owner === 'granted'
                ? 'Kiosk mode is available — the app can pin the whole device and block force-stop.'
                : 'Not a device owner. The app still seals via Accessibility + Overlay, but a student could force-stop it. Set device owner with: adb shell dpm set-device-owner com.btsoftware.lockdown/.LockdownAdminReceiver'}
            </Text>
          </View>
        </View>
        <Hairline />
        <Row k="Kiosk (lock-task)" v={guard?.kiosk === 'granted' ? 'Pinned' : 'Off'} />
        <Hairline />
        <Row k="Uninstall guard" v={guard?.admin === 'granted' ? 'Active' : 'Off'} />
      </Card>
      {guard?.owner === 'granted' ? (
        <Button
          title="Enter kiosk mode now"
          variant="mint"
          style={{ marginTop: 12 }}
          onPress={() => LockdownNative.enterKiosk().then(() => void refreshPermissionStatus()).catch(() => undefined)}
        />
      ) : null}

      {!enforcementAvailable ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={styles.warn}>
            {Platform.OS === 'ios'
              ? 'iOS enforcement is not wired in this build. The app syncs with BT LEARNING but cannot intercept other apps.'
              : 'Enforcement is not linked (Expo Go / preview build). Build the APK to seal this device.'}
          </Text>
        </Card>
      ) : null}

      <Label style={{ marginTop: 22, marginBottom: 10 }}>About & support</Label>
      <Card>
        <View style={[styles.linkRow, { borderColor: colors.amber }]}>
          <View style={[styles.linkDot, { backgroundColor: colors.amber }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkT}>BUILT BY {SUPPORT.org.toUpperCase()}</Text>
            <Text style={styles.linkS}>
              {SUPPORT.product} is owned and maintained by {SUPPORT.ownerName} of{' '}
              {SUPPORT.org}, companion to BT LEARNING. Having trouble — wrong lock, login,
              or a phone quirk? Reach support directly below.
            </Text>
          </View>
        </View>
        <Hairline />
        <Row
          k="Calls & WhatsApp"
          v={`${SUPPORT.phoneDisplay} ›`}
          onPress={() => void Linking.openURL(SUPPORT.phoneTel).catch(() => undefined)}
        />
        <Hairline />
        <Row
          k="WhatsApp chat"
          v="Message support ›"
          onPress={() => void Linking.openURL(SUPPORT.whatsapp).catch(() => undefined)}
        />
        <Hairline />
        <Row
          k="Email"
          v={`${SUPPORT.email} ›`}
          onPress={() => void Linking.openURL(SUPPORT.emailMailto).catch(() => undefined)}
        />
      </Card>

      <Label style={{ marginTop: 22, marginBottom: 10 }}>Suite</Label>
      <Card>
        <Row k="Product" v={`${SUPPORT.product} ${SUPPORT.version}`} />
        <Hairline />
        <Row k="Sibling" v="BT LEARNING" />
        <Hairline />
        <Row k="Owner" v={`${SUPPORT.ownerName} · ${SUPPORT.org}`} />
      </Card>

      <Button title="Sign out of this device" variant="ghost" onPress={signOut} style={{ marginTop: 22 }} />
    </ScrollView>
  );
}

function sealLabel(p: { seal?: { enforcing: boolean; listedInSettings: boolean; boundInProcess: boolean; liveAgeSeconds: number } } | null): string {
  if (!p?.seal) return 'unavailable';
  if (p.seal.enforcing) return 'Bound and receiving events';
  if (p.seal.listedInSettings && !p.seal.boundInProcess) return 'Listed but killed by the device';
  return 'OFF — enable it in Accessibility';
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
