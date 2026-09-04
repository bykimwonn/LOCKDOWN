import { RefreshButton } from '@/src/components/RefreshButton';
import { StatusRing } from '@/src/components/StatusRing';
import { Body, Button, Label, Pill } from '@/src/components/ui';
import { useApp } from '@/src/store/AppState';
import { summarizeProtection } from '@/src/services/protection';
import { formatRemain, serverNow } from '@/src/services/serverTime';
import { colors, fonts } from '@/src/theme';
import { WHITELIST } from '@/src/data/seed';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LockdownScreen() {
  const {
    lockdown, sessions, emergencyUnlock, enforcementAvailable, gate,
    protection, refreshProtection, openSealSettings,
  } = useApp();
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const [, tick] = useState(0);
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holdMs, setHoldMs] = useState(0);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  // The sealed screen is where a dead enforcement layer is most visible, so it
  // shows the verified state (native health controller) rather than "session is
  // running", and refreshes it while mounted.
  useEffect(() => {
    void refreshProtection();
    const id = setInterval(() => void refreshProtection(), 8000);
    return () => clearInterval(id);
  }, [refreshProtection]);

  // Exit the counting screen the moment the device is unlocked (end time,
  // teacher release, emergency unlock, or a refresh that confirmed the seal
  // is gone). The root Gate also routes this — this is the local guarantee
  // so the student never has to force-stop the app to escape the timer.
  useEffect(() => {
    if (!lockdown.active && gate === 'app') {
      router.replace('/(app)');
    }
  }, [lockdown.active, gate, router]);

  const session = sessions.find((s) => s.id === lockdown.sessionId);
  const end = lockdown.serverEndsAt ? Date.parse(lockdown.serverEndsAt) : 0;
  const start = lockdown.serverStartedAt ? Date.parse(lockdown.serverStartedAt) : end - 1;
  const now = serverNow().getTime();
  const remain = Math.max(0, end - now);
  const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));

  const beginHold = () => {
    setHoldMs(0);
    const t0 = Date.now();
    hold.current = setInterval(() => {
      const ms = Date.now() - t0;
      setHoldMs(ms);
        if (ms >= 2800) {
          if (hold.current) clearInterval(hold.current);
          hold.current = null;
          setHoldMs(0);
          setConfirm(true);
        }
    }, 40);
  };

  const endHold = () => {
    if (hold.current) clearInterval(hold.current);
    hold.current = null;
    setHoldMs(0);
  };

  const summary = summarizeProtection(protection);
  const sealLost = summary.level === 'NETWORK_ONLY' || summary.level === 'DEGRADED';
  const netOn = protection?.state === 'ACTIVE';

  return (
    <View style={[styles.root, { paddingTop: inset.top + 10, paddingBottom: inset.bottom + 16 }]}>
      <View style={styles.top}>
        <Pill color={sealLost ? colors.crimson : netOn ? colors.mint : colors.amber}>
          {netOn ? 'SEALED + NET BLOCKED' : sealLost ? 'SEAL SERVICE OFF' : 'SEALED'}
        </Pill>
        <View style={styles.topRight}>
          <Label>SERVER TIME</Label>
          {/* Manual re-sync — picks up an early teacher release the moment
              it happens instead of waiting for the next poll. */}
          <RefreshButton size={15} />
        </View>
      </View>
      <Label tone="amber" style={{ textAlign: 'center', marginTop: 18 }}>
        {session?.subject ?? 'Deep Work'}
      </Label>
      <Text style={styles.title}>{session?.title ?? 'Lockdown'}</Text>
      <View style={styles.ring}>
        <StatusRing
          progress={progress}
          label="Remaining"
          value={formatRemain(remain)}
          sub={session?.focusNote ?? 'Phone is sealed. Study.'}
          tone="mint"
        />
      </View>
      <Body dim style={{ textAlign: 'center', paddingHorizontal: 20 }}>
        Social, games and unapproved tabs are shielded. Essential tools stay open.
      </Body>
      {enforcementAvailable && protection ? (
        <Text
          style={{
            ...styles.statusLine,
            color: sealLost ? colors.crimson : netOn ? colors.mint : colors.amber,
          }}
        >
          {summary.headline} — {protection.statusLine}
        </Text>
      ) : null}
      {sealLost ? (
        <Pressable onPress={() => void openSealSettings()} style={styles.fixRow}>
          <Text style={styles.fixT}>Seal service is off — tap to re-enable it ›</Text>
        </Pressable>
      ) : null}
      <View style={styles.chips}>
        {WHITELIST.slice(0, 4).map((w) => (
          <View key={w.id} style={styles.chip}>
            <Text style={styles.chipT}>{w.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {!enforcementAvailable ? (
        <Text style={styles.noEnforce}>
          Preview mode: no native enforcement linked. Build the APK to seal this device.
        </Text>
      ) : null}
      <Pressable onPressIn={beginHold} onPressOut={endHold} style={styles.hold}>
        <View style={[styles.holdFill, { width: `${Math.min(100, (holdMs / 2800) * 100)}%` }]} />
        <Text style={styles.holdT}>Hold to request emergency unlock</Text>
      </Pressable>
      <Text style={styles.warn}>-25 ELO  ·  streak broken  ·  session voided</Text>
      <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Label tone="amber">Penalty warning</Label>
            <Text style={styles.modalT}>Emergency unlock</Text>
            <Text style={styles.modalB}>
              This voids the session, deducts 25 ELO, and breaks your streak in BT LEARNING.
            </Text>
            <Button title="Stay sealed" onPress={() => setConfirm(false)} />
            <Button
              title="Unlock anyway"
              variant="danger"
              style={{ marginTop: 10 }}
              onPress={() => {
                setConfirm(false);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
                emergencyUnlock();
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  statusLine: {
    fontFamily: fonts.sansMed,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
    letterSpacing: 0.2,
  },
  fixRow: {
    marginTop: 10,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.crimson,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  fixT: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.crimson },
  root: { flex: 1, backgroundColor: '#040405', paddingHorizontal: 20 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: {
    fontFamily: fonts.sansBold,
    color: colors.ink,
    fontSize: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  ring: { alignItems: 'center', marginVertical: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 },
  chip: {
    borderWidth: 1,
    borderColor: colors.mint,
    backgroundColor: colors.mintSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipT: { fontFamily: fonts.monoMed, color: colors.mint, fontSize: 10, letterSpacing: 0.8 },
  hold: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.crimson,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.crimsonSoft,
  },
  holdT: { fontFamily: fonts.sansSemi, color: colors.crimson, fontSize: 13 },
  warn: {
    fontFamily: fonts.mono,
    color: colors.inkFaint,
    fontSize: 10,
    letterSpacing: 0.8,
    textAlign: 'center',
    marginTop: 10,
  },
  noEnforce: {
    fontFamily: fonts.sans,
    color: colors.crimson,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 17,
  },
  modalBack: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    padding: 20,
    gap: 10,
  },
  modalT: { fontFamily: fonts.sansBold, color: colors.ink, fontSize: 20 },
  modalB: { fontFamily: fonts.sans, color: colors.inkMute, fontSize: 13, lineHeight: 19 },
});
