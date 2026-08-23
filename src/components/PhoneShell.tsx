import { colors, fonts } from '@/src/theme';
import React from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

/**
 * On a wide desktop preview the app sits inside a device chrome
 * so BT LOCKDOWN still reads as a phone product, not a website.
 */
export function PhoneShell({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const framed = Platform.OS === 'web' && width >= 760;

  if (!framed) {
    return <View style={styles.fill}>{children}</View>;
  }

  const phoneW = Math.min(402, Math.floor(height * 0.46));
  const phoneH = Math.min(874, Math.floor(height * 0.92));

  return (
    <View style={styles.stage}>
      <View style={styles.brandCol}>
        <Text style={styles.kicker}>BT SOFTWARE SOLUTIONS</Text>
        <Text style={styles.title}>BT LOCKDOWN</Text>
        <Text style={styles.blurb}>
          Native companion for BT LEARNING. When the AI timetable fires Deep Work, the phone seals.
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>iOS · Family Controls</Text>
          <Text style={styles.meta}>Android · Accessibility</Text>
        </View>
      </View>
      <View style={[styles.device, { width: phoneW, height: phoneH }]}>
        <View style={styles.notch} />
        <View style={styles.screen}>{children}</View>
        <View style={styles.home} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  stage: {
    flex: 1,
    backgroundColor: '#030304',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 64,
    padding: 32,
  },
  brandCol: { maxWidth: 360, gap: 14 },
  kicker: {
    fontFamily: fonts.monoMed,
    color: colors.amber,
    letterSpacing: 2.6,
    fontSize: 11,
  },
  title: {
    fontFamily: fonts.sansBlack,
    color: colors.ink,
    fontSize: 56,
    letterSpacing: -2,
    lineHeight: 56,
  },
  blurb: {
    fontFamily: fonts.sans,
    color: colors.inkMute,
    fontSize: 16,
    lineHeight: 24,
  },
  metaRow: { gap: 8, marginTop: 8 },
  meta: {
    fontFamily: fonts.mono,
    color: colors.inkFaint,
    fontSize: 12,
  },
  device: {
    backgroundColor: '#0A0A0C',
    borderRadius: 44,
    borderWidth: 10,
    borderColor: '#1A1B20',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
  },
  notch: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    width: 118,
    height: 28,
    borderRadius: 20,
    backgroundColor: '#050506',
    zIndex: 20,
    left: '50%',
    marginLeft: -59,
  },
  screen: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  home: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -54,
    width: 108,
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(243,240,232,0.18)',
    zIndex: 20,
  },
});
