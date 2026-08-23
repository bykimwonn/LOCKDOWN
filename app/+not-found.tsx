import { Button, Display, Label } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

export default function NotFound() {
  return (
    <View style={styles.root}>
      <Label tone="amber">404</Label>
      <Display style={{ marginVertical: 16 }}>No such surface.</Display>
      <Link href="/(app)" asChild>
        <Button title="Return to command" />
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
