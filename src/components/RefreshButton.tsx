import { useApp } from '@/src/store/AppState';
import { colors } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import { RefreshCw } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';

/**
 * Top-bar refresh button.
 * Forces a full app refresh via AppState.refreshApp(): one immediate
 * reconnect to BT LEARNING (sessions + profile + arm/disarm), a re-read of
 * the device's real permission state, and a native-seal reconciliation so a
 * released phone leaves the counting screen. Spins while the pass is
 * running and gives a success/warning haptic when it lands.
 */
export function RefreshButton({ size = 16 }: { size?: number }) {
  const { refreshApp, refreshing } = useApp();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!refreshing) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 850,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh app"
      accessibilityState={{ busy: refreshing }}
      disabled={refreshing}
      hitSlop={10}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        void refreshApp().then((ok) => {
          Haptics.notificationAsync(
            ok
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning
          ).catch(() => undefined);
        });
      }}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.72 : 1 }]}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <RefreshCw color={refreshing ? colors.amber : colors.inkMute} size={size} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
