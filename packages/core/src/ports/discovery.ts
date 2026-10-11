import type { AppError } from '../domain/errors';
import type { Result } from '../domain/result';
import type { PeerAddress, Unsubscribe } from './transport';

/** Data published on the LAN via mDNS TXT records (docs/PLAN.md §6.1). Never contains names. */
export interface Advertisement {
  readonly deviceId: string;
  readonly port: number;
  /** HMAC-derived tag so devices can ignore other groups. */
  readonly groupTag: string;
  readonly pairingMode: boolean;
  readonly protocolVersion: number;
}

export interface DiscoveredService {
  /** Stable for the lifetime of the advertisement; used to match `onDown`. */
  readonly instanceId: string;
  readonly deviceId: string;
  readonly groupTag: string;
  readonly pairingMode: boolean;
  readonly protocolVersion: number;
  readonly addresses: readonly PeerAddress[];
}

export interface DiscoveryListener {
  onUp(service: DiscoveredService): void;
  onDown(instanceId: string): void;
}

export interface Advertiser {
  update(advertisement: Advertisement): Promise<void>;
  stop(): Promise<void>;
}

export interface DiscoveryPort {
  /** Publishes this device (hubs only). */
  advertise?(advertisement: Advertisement): Promise<Result<Advertiser, AppError>>;
  /** Watches for ClipBridge services on the LAN. */
  browse(listener: DiscoveryListener): Promise<Result<Unsubscribe, AppError>>;
}
