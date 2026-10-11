import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Shares arrive as a deep link on iOS (`clipbridge://dataUrl=…`); send them to the
 * home screen, where the share-intent hook picks them up, instead of a missing route.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return path.includes(`dataUrl=${getShareExtensionKey()}`) ? '/' : path;
  } catch {
    return '/';
  }
}
