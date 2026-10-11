import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';

import { SystemEffects } from '@/features/system/system-effects';
import { AppProvider } from '@/state/app-context';

export default function RootLayout(): ReactElement {
  return (
    <ShareIntentProvider>
      <AppProvider>
        <SystemEffects>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ title: 'ClipBridge' }} />
            <Stack.Screen name="scan" options={{ title: 'Scan QR code', presentation: 'modal' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
        </SystemEffects>
      </AppProvider>
    </ShareIntentProvider>
  );
}
