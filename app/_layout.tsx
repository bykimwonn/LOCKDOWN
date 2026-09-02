import { PhoneShell } from '@/src/components/PhoneShell';
import { AppProvider, useApp } from '@/src/store/AppState';
import { colors } from '@/src/theme';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Gate() {
  const { hydrated, gate, lockdown } = useApp();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    const root = segments[0];
    if (lockdown.active && root !== 'lockdown') {
      router.replace('/lockdown');
      return;
    }
    if (!lockdown.active) {
      if (gate === 'onboarding' && root !== 'onboarding') router.replace('/onboarding');
      else if (gate === 'auth' && root !== 'auth') router.replace('/auth');
      else if (gate === 'permissions' && root !== 'permissions') router.replace('/permissions');
      // gate === 'app': land on the tabs — INCLUDING when sitting on
      // /lockdown. An unlocked device must LEAVE the counting screen the
      // moment the seal is released (end time, teacher release, emergency
      // unlock, watchdog cleanup); previously /lockdown was exempt from
      // this redirect, so the countdown stayed up until the student
      // force-stopped the app.
      else if (gate === 'app' && root !== '(app)') router.replace('/(app)');
    }
  }, [hydrated, gate, lockdown.active, segments, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
    />
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppProvider>
        <PhoneShell>
          <StatusBar style="light" />
          <Gate />
        </PhoneShell>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
