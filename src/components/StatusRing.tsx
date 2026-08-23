import { colors, fonts } from '@/src/theme';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export function StatusRing({
  progress,
  label,
  value,
  sub,
  tone = 'amber',
  size = 236,
}: {
  progress: number;
  label: string;
  value: string;
  sub: string;
  tone?: 'amber' | 'mint' | 'idle';
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const color = tone === 'mint' ? colors.mint : tone === 'idle' ? colors.inkFaint : colors.amber;
  const dash = useMemo(() => ({ dash: c * p, gap: c }), [c, p]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(243,240,232,0.07)"
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash.dash} ${dash.gap}`}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={styles.kicker}>{label}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontFamily: fonts.monoMed,
    fontSize: 11,
    letterSpacing: 2.4,
    color: colors.inkMute,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  value: {
    fontFamily: fonts.monoBold,
    fontSize: 40,
    letterSpacing: -1,
  },
  sub: {
    fontFamily: fonts.sansMed,
    fontSize: 13,
    color: colors.inkMute,
    marginTop: 6,
  },
});
