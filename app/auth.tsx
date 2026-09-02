import { Ambient, Body, Button, Display, Field, Label } from '@/src/components/ui';
import { getApiBase, normalizeApiBase, setApiBase } from '@/src/config';
import { SUPPORT } from '@/src/constants/support';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Auth() {
  const { login } = useApp();
  const inset = useSafeAreaInsets();
  const [ident, setIdent] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showUrlHelp, setShowUrlHelp] = useState(false);

  const normalizedServer = normalizeApiBase(server);

  /** Render free tier sleeps; the first request can take ~50s. Time out early and retry. */
  const withWakeRetry = async (fn: () => Promise<void>): Promise<Error | null> => {
    const attempt = async (): Promise<Error | null> => {
      try {
        await fn(); // req() enforces its own 20s timeout
        return null;
      } catch (e) {
        return e instanceof Error ? e : new Error('login_failed');
      }
    };
    let first = await attempt();
    if (first && !['invalid_credentials', 'id_and_password_required', 'too_many_attempts'].includes(first.message)) {
      // Network-level failure — probably a cold Render. Wait, then try once more.
      await new Promise((r) => setTimeout(r, 8000));
      const second = await attempt();
      first = second ?? first;
    }
    return first;
  };

  const go = async () => {
    setError('');
    if (!server.trim()) {
      setError('Paste your BT LEARNING URL (the Render address).');
      return;
    }
    if (!ident.trim() || !password) {
      setError('Student ID or email, and password, are required.');
      return;
    }
    setApiBase(server);
    setBusy(true);
    try {
      const err = await withWakeRetry(() => login(ident.trim(), password));
      if (err) throw err;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'login_failed';
      setError(
        msg === 'invalid_credentials'
          ? 'Wrong ID or password. Use the same login as the BT LEARNING website.'
          : msg === 'too_many_attempts'
            ? 'Too many sign-in attempts. Wait a few minutes and try again.'
            : msg === 'Set your BT LEARNING URL first.'
              ? msg
              : 'Could not reach BT LEARNING. Check the URL — if it is a Render service, it may be waking up.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: inset.top + 18, paddingBottom: inset.bottom + 18, paddingHorizontal: 22, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Ambient />
        <Label tone="amber">BT LEARNING  ·  LIVE ACCOUNT</Label>
        <Display style={{ marginTop: 18 }}>Sign in to{'\n'}the suite.</Display>
        <Body dim style={{ marginTop: 12, marginBottom: 22 }}>
          Same student ID or email you use on the website. No demo logins.
        </Body>

        <View style={styles.labelRow}>
          <Label>BT LEARNING URL</Label>
          <Pressable onPress={() => setShowUrlHelp((v) => !v)} hitSlop={10}>
            <Label tone="amber">{showUrlHelp ? 'Hide help' : 'What is this?'}</Label>
          </Pressable>
        </View>
        {showUrlHelp ? (
          <View style={styles.helpCard}>
            <Text style={styles.helpT}>
              The BT LEARNING URL is the web address of your school's BT LEARNING website —
              the same address your teacher opens in a browser.
            </Text>
            <Text style={styles.helpT}>
              It looks like this:  <Text style={styles.helpMono}>https://bt-learning.onrender.com</Text>
            </Text>
            <Text style={styles.helpT}>
              • It always starts with <Text style={styles.helpMono}>https://</Text> — if you
              forget it, we add it for you automatically.{'\n'}
              • No spaces, no www, no page name at the end — just the address of the site.{'\n'}
              • Not sure? Ask your teacher, or contact support below.
            </Text>
          </View>
        ) : null}
        <View style={{ height: 8 }} />
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={server}
          onChangeText={setServer}
          placeholder="https://your-service.onrender.com"
        />
        {normalizedServer ? (
          <Text style={styles.preview}>Will connect to:  {normalizedServer}</Text>
        ) : null}
        <Label style={{ marginBottom: 8, marginTop: 16 }}>Student ID or email</Label>
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          value={ident}
          onChangeText={setIdent}
          placeholder="STU-001 or you@school.edu"
        />
        <Label style={{ marginBottom: 8, marginTop: 16 }}>Password</Label>
        <Field
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Your BT LEARNING password"
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={{ flex: 1, minHeight: 24 }} />
        <Button title={busy ? 'Connecting…' : 'Connect device'} onPress={go} disabled={busy} />
        <Text style={styles.fine}>
          When your AI timetable is live on the website, this phone seals.
        </Text>

        {/* Sign-in support — students regularly don't know the URL or their ID. */}
        <View style={styles.support}>
          <Label style={{ marginBottom: 8 }}>Need help signing in?</Label>
          <Text style={styles.supportBody}>
            {SUPPORT.ownerName} · {SUPPORT.org}
          </Text>
          <View style={styles.supportLinks}>
            <Pressable onPress={() => void Linking.openURL(SUPPORT.phoneTel).catch(() => undefined)} hitSlop={8}>
              <Text style={styles.supportLink}>Call</Text>
            </Pressable>
            <Text style={styles.supportSep}>·</Text>
            <Pressable onPress={() => void Linking.openURL(SUPPORT.whatsapp).catch(() => undefined)} hitSlop={8}>
              <Text style={styles.supportLink}>WhatsApp {SUPPORT.phoneDisplay}</Text>
            </Pressable>
            <Text style={styles.supportSep}>·</Text>
            <Pressable onPress={() => void Linking.openURL(SUPPORT.emailMailto).catch(() => undefined)} hitSlop={8}>
              <Text style={styles.supportLink}>Email</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  helpCard: {
    borderWidth: 1,
    borderColor: colors.amberLine,
    backgroundColor: colors.amberSoft,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    gap: 8,
  },
  helpT: {
    fontFamily: fonts.sans,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  helpMono: {
    fontFamily: fonts.monoMed,
    color: colors.amber,
    fontSize: 12,
  },
  preview: {
    fontFamily: fonts.mono,
    color: colors.mint,
    fontSize: 11,
    marginTop: 8,
  },
  err: {
    fontFamily: fonts.sansMed,
    color: colors.crimson,
    fontSize: 13,
    marginTop: 14,
    lineHeight: 18,
  },
  fine: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 16,
  },
  support: {
    marginTop: 22,
    alignItems: 'center',
    gap: 4,
  },
  supportBody: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 12,
  },
  supportLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  supportLink: {
    fontFamily: fonts.sansSemi,
    color: colors.amber,
    fontSize: 13,
  },
  supportSep: {
    fontFamily: fonts.sans,
    color: colors.inkFaint,
    fontSize: 13,
  },
});
