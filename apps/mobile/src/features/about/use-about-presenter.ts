import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { type AppInfo, buildAppInfo, type MobilePlatform } from './app-info';

/** Provides version info for the About section. */
export function useAboutPresenter(): AppInfo {
  const platform: MobilePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
  return buildAppInfo(Constants.expoConfig?.version, platform);
}
