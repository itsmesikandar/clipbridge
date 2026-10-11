import {
  type AppError,
  appError,
  type DiscoveredService,
  type DiscoveryListener,
  type DiscoveryPort,
  err,
  type LocalNetworkPermission,
  type LoggerPort,
  ok,
  type Result,
  type Unsubscribe,
} from '@clipbridge/core';
import Zeroconf, { type Service } from 'react-native-zeroconf';

/** `_clipbridge._tcp.local` (docs/PLAN.md §6.1). */
export const SERVICE_TYPE = 'clipbridge';

/** Converts a resolved mDNS service into what core needs; null if malformed. */
export function toDiscoveredService(service: Service): DiscoveredService | null {
  const txt = service.txt;
  const version = Number(txt.v);
  if (!txt.did || !txt.gt || !Number.isInteger(version)) return null;
  const ipv4 =
    service.ipv4.length > 0
      ? service.ipv4
      : service.addresses.filter((a) => /^\d+(\.\d+){3}$/.test(a));
  if (ipv4.length === 0) return null;
  return {
    instanceId: service.name,
    deviceId: txt.did,
    groupTag: txt.gt,
    pairingMode: txt.pm === '1',
    protocolVersion: version,
    addresses: ipv4.map((host) => ({ host, port: service.port })),
  };
}

/**
 * mDNS browsing with react-native-zeroconf (Android NsdManager). Phones only
 * browse; they never advertise. `restart()` re-scans after a network change.
 */
export class ZeroconfDiscovery implements DiscoveryPort {
  private readonly zeroconf = new Zeroconf();
  private readonly listeners = new Set<DiscoveryListener>();
  private readonly known = new Map<string, DiscoveredService>();
  private scanning = false;

  constructor(private readonly logger: LoggerPort) {
    this.zeroconf.on('resolved', (service) => {
      const discovered = toDiscoveredService(service);
      if (!discovered) return;
      this.known.set(discovered.instanceId, discovered);
      for (const listener of [...this.listeners]) listener.onUp(discovered);
    });
    this.zeroconf.on('remove', (name) => {
      if (!this.known.delete(name)) return;
      for (const listener of [...this.listeners]) listener.onDown(name);
    });
    this.zeroconf.on('error', (error) => {
      this.logger.warn('mDNS error', { code: String(error.code), domain: error.domain });
    });
  }

  browse(listener: DiscoveryListener): Promise<Result<Unsubscribe, AppError>> {
    try {
      this.listeners.add(listener);
      for (const service of this.known.values()) listener.onUp(service);
      if (!this.scanning) this.startScan();
      return Promise.resolve(
        ok(() => {
          this.listeners.delete(listener);
          if (this.listeners.size === 0) this.stopScan();
        }),
      );
    } catch (error) {
      this.listeners.delete(listener);
      return Promise.resolve(
        err(
          appError('PROTOCOL_ERROR', 'mDNS scan failed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }
  }

  /** Forgets what was found and scans again (network changed). */
  restart(): void {
    if (!this.scanning) return;
    this.stopScan();
    for (const instanceId of this.known.keys()) {
      for (const listener of [...this.listeners]) listener.onDown(instanceId);
    }
    this.known.clear();
    this.startScan();
  }

  /** Android 17+ / iOS: Local Network permission. */
  async localNetworkPermission(): Promise<LocalNetworkPermission> {
    try {
      return await this.zeroconf.checkLocalNetworkAccess({ type: SERVICE_TYPE, request: true });
    } catch {
      return 'unknown';
    }
  }

  private startScan(): void {
    this.scanning = true;
    this.zeroconf.scan({ type: SERVICE_TYPE, protocol: 'tcp', domain: 'local.' });
  }

  private stopScan(): void {
    this.scanning = false;
    this.zeroconf.stop();
  }
}
