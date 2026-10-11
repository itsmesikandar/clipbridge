import type { NetworkSnapshot } from '../domain/network';
import type { Unsubscribe } from './transport';

export type LocalNetworkPermission = 'granted' | 'denied' | 'unknown';

export interface NetworkInfoPort {
  current(): Promise<NetworkSnapshot>;
  /** Fires when the network changes (Wi-Fi switch, IP change, cable unplugged). */
  onChange(listener: (snapshot: NetworkSnapshot) => void): Unsubscribe;
  /** iOS Local Network permission; other platforms return `granted`. */
  localNetworkPermission(): Promise<LocalNetworkPermission>;
}
