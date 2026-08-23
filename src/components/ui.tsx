import { colors, fonts, radius } from '@/src/theme';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export function Label({
  children,
  style,
  tone = 'mute',
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  tone?: 'mute' | 'amber' | 'mint' | 'ink';
}) {
  const color =
    tone === 'amber' ? colors.amber : tone === 'mint' ? colors.mint : tone === 'ink' ? colors.ink : colors.inkMute;
  return <Text style={[styles.label, { color }, style]}>{children}</Text>;
}

export function Display({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.display, style]}>{children}</Text>;
}

export function Body({
  children,
  style,
  dim,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  dim?: boolean;
}) {
  return <Text style={[styles.body, dim && { color: colors.inkMute }, style]}>{children}</Text>;
}

export function Mono({
  children,
  style,
  size = 13,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  size?: number;
}) {
  return <Text style={[styles.mono, { fontSize: size }, style]}>{children}</Text>;
}

export function Pill({
  children,
  color = colors.amber,
  fill,
}: {
  children: React.ReactNode;
  color?: string;
  fill?: string;
}) {
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: fill ?? `${color}18` }]}>
      <Text style={[styles.pillText, { color }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'mint';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
} & Omit<PressableProps, 'style'>) {
  const bg =
    variant === 'primary'
      ? colors.amber
      : variant === 'danger'
        ? colors.crimson
        : variant === 'mint'
          ? colors.mint
          : 'transparent';
  const fg = variant === 'ghost' ? colors.ink : '#140C04';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: variant === 'ghost' ? colors.lineStrong : bg, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
        style,
      ]}
    >
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      selectionColor={colors.amber}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}

export function Hairline() {
  return <View style={styles.hair} />;
}

export function Ambient() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['rgba(255,122,24,0.10)', 'transparent', 'rgba(61,220,151,0.05)']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.grid} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.monoMed,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  display: {
    fontFamily: fonts.sansBlack,
    fontSize: 34,
    color: colors.ink,
    letterSpacing: -1.1,
    lineHeight: 38,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  mono: {
    fontFamily: fonts.mono,
    color: colors.ink,
    letterSpacing: 0.3,
  },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  pillText: {
    fontFamily: fonts.monoMed,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.bgCard,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
  },
  btn: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnText: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    letterSpacing: 0.4,
  },
  field: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.bgRaised,
    color: colors.ink,
    paddingHorizontal: 16,
    fontFamily: fonts.sansMed,
    fontSize: 16,
  },
  hair: {
    height: 1,
    backgroundColor: colors.line,
    width: '100%',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.18,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
});
