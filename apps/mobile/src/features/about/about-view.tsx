import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppInfo } from './app-info';

const PLATFORM_LABELS = { android: 'Android', ios: 'iOS' } as const;

export function AboutView({ state }: { readonly state: AppInfo }): ReactElement {
  const rows: readonly (readonly [string, string])[] = [
    ['App', state.appVersion],
    ['Core', state.coreVersion],
    ['Protocol', `v${state.protocolVersion}`],
    ['Platform', PLATFORM_LABELS[state.platform]],
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{value}</Text>
        </View>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  label: {
    width: 80,
    opacity: 0.7,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
});
