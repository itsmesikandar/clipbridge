import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';

export default function RootLayout(): ReactElement {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ title: 'ClipBridge' }} />
    </>
  );
}
