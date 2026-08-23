import { Ambient, Body, Button, Display, Field, Label } from '@/src/components/ui';
import { getApiBase, setApiBase } from '@/src/config';
import { useApp } from '@/src/store/AppState';
import { colors, fonts } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Auth() {
  const { login } = useApp();
  const inset = useSafeAreaInsets();
  const [ident, setIdent] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      await login(ident.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'login_failed';
      setError(
        msg === 'invalid_credentials'
          ? 'Wrong ID or password. Use the same login as the BT LEARNING website.'
          : msg === 'Set your BT LEARNING URL first.'
            ? msg
            : 'Could not reach BT LEARNING. Check the URL and that Render is awake.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: inset.top + 18, paddingBottom: inset.bottom + 18 }]}>
        <Ambient />
        <Label tone="amber">BT LEARNING  ·  LIVE ACCOUNT</Label>
        <Display style={{ marginTop: 18 }}>Sign in to{'\n'}the suite.</Display>
        <Body dim style={{ marginTop: 12, marginBottom: 22 }}>
          Same student ID or email you use on the website. No demo logins.
        </Body>

        <Label style={{ marginBottom: 8 }}>BT LEARNING URL</Label>
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={server}
          onChangeText={setServer}
          placeholder="https://your-service.onrender.com"
        />
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
        <View style={{ flex: 1 }} />
        <Button title={busy ? 'Connecting…' : 'Connect device'} onPress={go} disabled={busy} />
        <Text style={styles.fine}>
          When your AI timetable is live on the website, this phone seals.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22 },
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
});
