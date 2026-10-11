import {
  type Advertisement,
  type Advertiser,
  type AppError,
  type DiscoveredService,
  type DiscoveryListener,
  type DiscoveryPort,
  type LoggerPort,
  ok,
  type Result,
  type Unsubscribe,
} from '@clipbridge/core';
import { Bonjour, type Browser, type Service } from 'bonjour-service';

/** mDNS service type: `_clipbridge._tcp.local` (docs/PLAN.md §6.1). */
export const SERVICE_TYPE = 'clipbridge';

/** mDNS answers are cached; ask again periodically so new/returning peers show up quickly. */
const REQUERY_INTERVAL_MS = 15_000;

interface ActiveBrowser {
  readonly listener: DiscoveryListener;
  browser: Browser | null;
  readonly known: Set<string>;
}

/** Converts an mDNS service into what core needs, ignoring anything malformed. */
export function toDiscoveredService(
  service: Pick<Service, 'fqdn' | 'name' | 'port' | 'txt' | 'addresses' | 'referer'>,
): DiscoveredService | null {
  const txt = (service.txt ?? {}) as Record<string, unknown>;
  const deviceId = typeof txt.did === 'string' ? txt.did : null;
  const groupTag = typeof txt.gt === 'string' ? txt.gt : null;
  const version = Number(txt.v);
  if (!deviceId || !groupTag || !Number.isInteger(version)) return null;

  const ipv4 = (service.addresses ?? []).filter((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address));
  const hosts =
    ipv4.length > 0 ? ipv4 : service.referer?.family === 'IPv4' ? [service.referer.address] : [];
  if (hosts.length === 0) return null;

  return {
    instanceId: service.fqdn || service.name,
    deviceId,
    groupTag,
    pairingMode: txt.pm === '1',
    protocolVersion: version,
    addresses: hosts.map((host) => ({ host, port: service.port })),
  };
}

function toTxt(advertisement: Advertisement): Record<string, string> {
  return {
    v: String(advertisement.protocolVersion),
    did: advertisement.deviceId,
    gt: advertisement.groupTag,
    pm: advertisement.pairingMode ? '1' : '0',
  };
}

/**
 * mDNS/DNS-SD discovery via `bonjour-service`. Call `restart()` when the network
 * changes so sockets are re-bound to the new interface.
 */
export class BonjourDiscovery implements DiscoveryPort {
  private bonjour: Bonjour;
  private advertisement: Advertisement | null = null;
  private published: Service | null = null;
  private readonly browsers = new Set<ActiveBrowser>();
  private requeryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly logger: LoggerPort) {
    this.bonjour = this.createBonjour();
  }

  advertise(advertisement: Advertisement): Promise<Result<Advertiser, AppError>> {
    this.advertisement = advertisement;
    this.publish();
    return Promise.resolve(
      ok({
        update: async (next) => {
          this.advertisement = next;
          await this.unpublish();
          this.publish();
        },
        stop: async () => {
          this.advertisement = null;
          await this.unpublish();
        },
      }),
    );
  }

  browse(listener: DiscoveryListener): Promise<Result<Unsubscribe, AppError>> {
    const entry: ActiveBrowser = { listener, browser: null, known: new Set() };
    this.browsers.add(entry);
    this.startBrowser(entry);
    this.ensureRequery();
    return Promise.resolve(
      ok(() => {
        entry.browser?.stop();
        this.browsers.delete(entry);
        if (this.browsers.size === 0) this.stopRequery();
      }),
    );
  }

  /** Re-creates the mDNS socket after a network change and re-announces everything. */
  async restart(): Promise<void> {
    for (const entry of this.browsers) {
      entry.browser?.stop();
      entry.browser = null;
      for (const instanceId of entry.known) entry.listener.onDown(instanceId);
      entry.known.clear();
    }
    await this.unpublish();
    await new Promise<void>((resolve) => {
      this.bonjour.destroy(() => {
        resolve();
      });
    });
    this.bonjour = this.createBonjour();
    this.publish();
    for (const entry of this.browsers) this.startBrowser(entry);
  }

  async destroy(): Promise<void> {
    this.stopRequery();
    for (const entry of this.browsers) entry.browser?.stop();
    this.browsers.clear();
    await this.unpublish();
    await new Promise<void>((resolve) => {
      this.bonjour.destroy(() => {
        resolve();
      });
    });
  }

  private createBonjour(): Bonjour {
    return new Bonjour({}, (error: unknown) => {
      this.logger.warn('mDNS error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private publish(): void {
    const advertisement = this.advertisement;
    if (!advertisement) return;
    this.published = this.bonjour.publish({
      name: `ClipBridge-${advertisement.deviceId.slice(4, 16)}`,
      type: SERVICE_TYPE,
      protocol: 'tcp',
      port: advertisement.port,
      txt: toTxt(advertisement),
      disableIPv6: true,
    });
    this.published.on('error', (error: unknown) => {
      this.logger.warn('mDNS publish failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private unpublish(): Promise<void> {
    const service = this.published;
    this.published = null;
    if (!service) return Promise.resolve();
    return new Promise((resolve) => {
      // `stop` is typed as CallableFunction by bonjour-service.
      const stop = service.stop as (callback: () => void) => void;
      stop.call(service, () => {
        resolve();
      });
      // Stop never calls back if the socket is already gone.
      setTimeout(resolve, 1_000).unref();
    });
  }

  private startBrowser(entry: ActiveBrowser): void {
    const browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' });
    const handleUp = (service: Service): void => {
      const discovered = toDiscoveredService(service);
      if (!discovered) return;
      entry.known.add(discovered.instanceId);
      entry.listener.onUp(discovered);
    };
    browser.on('up', handleUp);
    browser.on('txt-update', handleUp);
    browser.on('srv-update', handleUp);
    browser.on('down', (service: Service) => {
      const instanceId = service.fqdn || service.name;
      if (entry.known.delete(instanceId)) entry.listener.onDown(instanceId);
    });
    entry.browser = browser;
  }

  private ensureRequery(): void {
    if (this.requeryTimer) return;
    this.requeryTimer = setInterval(() => {
      for (const entry of this.browsers) entry.browser?.update();
    }, REQUERY_INTERVAL_MS);
    this.requeryTimer.unref();
  }

  private stopRequery(): void {
    if (this.requeryTimer) clearInterval(this.requeryTimer);
    this.requeryTimer = null;
  }
}
