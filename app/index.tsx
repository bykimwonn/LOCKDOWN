import { colors, fonts } from '@/src/theme';
import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export default function Splash() {
  useEffect(() => {
    // Gate in root layout advances after hydrate
  }, []);

  return (
    <View style={styles.root}>
      <Image source={require('../assets/icon.png')} style={styles.mark} />
      <Text style={styles.word}>BT LOCKDOWN</Text>
      <Text style={styles.sub}>BT SOFTWARE SOLUTIONS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  mark: { width: 96, height: 96, borderRadius: 24, marginBottom: 8 },
  word: {
    fontFamily: fonts.sansBlack,
    color: colors.ink,
    fontSize: 28,
    letterSpacing: 4,
  },
  sub: {
    fontFamily: fonts.monoMed,
    color: colors.inkFaint,
    fontSize: 11,
    letterSpacing: 2.4,
  },
});
