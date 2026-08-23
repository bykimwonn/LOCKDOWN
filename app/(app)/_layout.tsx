import { colors, fonts } from '@/src/theme';
import { CalendarRange, Crosshair, LayoutDashboard, Settings, Shield } from 'lucide-react-native';
import { Tabs } from 'expo-router';

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0A0B0E',
          borderTopColor: colors.line,
          height: 72,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarLabelStyle: {
          fontFamily: fonts.monoMed,
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Command',
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="timetable"
        options={{
          title: 'Timetable',
          tabBarIcon: ({ color, size }) => <CalendarRange color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="shield"
        options={{
          title: 'Shield',
          tabBarIcon: ({ color, size }) => <Shield color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="violations"
        options={{
          title: 'Breaches',
          tabBarIcon: ({ color, size }) => <Crosshair color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'System',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
