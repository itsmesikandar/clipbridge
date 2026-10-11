/**
 * Simulated LAN for tests: devices on the same subnet can discover and dial
 * each other; subnets, firewalls (blocked links) and listen failures can be
 * simulated. Delivery is asynchronous (microtasks) like a real socket.
 */

import { type AppError, appError, type PeerUnreachableCause } from '../domain/errors';
import type { NetworkKind, NetworkSnapshot } from '../domain/network';
import { err, ok, type Result } from '../domain/result';
import type {
  Advertisement,
  Advertiser,
  DiscoveredService,
  DiscoveryListener,
  DiscoveryPort,
} from '../ports/discovery';
import type { LocalNetworkPermission, NetworkInfoPort } from '../ports/network-info';
import type {
  Listener,
  PeerAddress,
  TransportCloseInfo,
  TransportConnection,
  TransportPort,
  Unsubscribe,
} from '../ports/transport';

const noop = (): void => undefined;

function later(task: () => void): void {
  void Promise.resolve().then(task);
}

class MemoryConnection implements TransportConnection {
  peer: MemoryConnection | null = null;
  private closeInfo: TransportCloseInfo | null = null;
  private readonly messageListeners = new Set<(data: string) => void>();
  private readonly closeListeners = new Set<(info: TransportCloseInfo) => void>();

  constructor(
    readonly remoteAddress: string,
    private readonly network: InMemoryNetwork,
    readonly localHost: string,
    readonly remoteHost: string,
  ) {}

  get isOpen(): boolean {
    return this.closeInfo === null;
  }

  send(data: string): void {
    const peer = this.peer;
    if (!this.isOpen || !peer) return;
    if (this.network.isBlocked(this.localHost, this.remoteHost)) return; // silently dropped
    later(() => {
      peer.receive(data);
    });
  }

  close(reason: string): void {
    if (!this.isOpen) return;
    this.finish({ local: true, reason });
    const peer = this.peer;
    if (peer) {
      later(() => {
        peer.finish({ local: false, reason });
      });
    }
  }

  onMessage(listener: (data: string) => void): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: (info: TransportCloseInfo) => void): Unsubscribe {
    if (this.closeInfo) {
      listener(this.closeInfo);
      return noop;
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Test hook: injects a raw frame as if the peer sent it. */
  inject(data: string): void {
    this.receive(data);
  }

  private receive(data: string): void {
    if (!this.isOpen) return;
    for (const listener of [...this.messageListeners]) listener(data);
  }

  finish(info: TransportCloseInfo): void {
    if (this.closeInfo) return;
    this.closeInfo = info;
    this.messageListeners.clear();
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener(info);
  }
}

interface BrowserEntry {
  readonly listener: DiscoveryListener;
  readonly visible: Set<string>;
}

export interface NodeOptions {
  readonly subnet: string | null;
  readonly kind?: NetworkKind;
}

/** One simulated device on the network. Exposes the transport/discovery/network ports. */
export class NetworkNode {
  subnet: string | null;
  kind: NetworkKind;
  permission: LocalNetworkPermission = 'granted';
  /** When true, `listen()` fails with PORT_IN_USE. */
  failListen = false;
  /** When set, `browse()` fails with this error (e.g. LOCAL_NETWORK_PERMISSION). */
  browseError: AppError | null = null;

  listening: { port: number; onConnection: (connection: TransportConnection) => void } | null =
    null;
  advertisement: Advertisement | null = null;
  readonly browsers = new Set<BrowserEntry>();
  readonly connections = new Set<MemoryConnection>();
  private readonly networkListeners = new Set<(snapshot: NetworkSnapshot) => void>();

  readonly transport: TransportPort;
  readonly discovery: DiscoveryPort;
  readonly networkInfo: NetworkInfoPort;

  constructor(
    readonly host: string,
    options: NodeOptions,
    private readonly network: InMemoryNetwork,
  ) {
    this.subnet = options.subnet;
    this.kind = options.kind ?? (options.subnet ? 'wifi' : 'none');

    this.transport = {
      dial: (address, timeoutMs) => this.network.dial(this, address, timeoutMs),
      listen: (preferredPort, onConnection) => this.listen(preferredPort, onConnection),
    };
    this.discovery = {
      advertise: (advertisement) => this.advertise(advertisement),
      browse: (listener) => this.browse(listener),
    };
    this.networkInfo = {
      current: () => Promise.resolve(this.snapshot()),
      onChange: (listener) => {
        this.networkListeners.add(listener);
        return () => this.networkListeners.delete(listener);
      },
      localNetworkPermission: () => Promise.resolve(this.permission),
    };
  }

  get ipv4(): string | null {
    if (!this.subnet) return null;
    const index = [...this.network.nodes.keys()].indexOf(this.host) + 10;
    return this.subnet.replace(/\.0\/\d+$/, `.${index}`);
  }

  snapshot(): NetworkSnapshot {
    return { kind: this.kind, ipv4: this.ipv4, subnet: this.subnet };
  }

  /** Moves the device to another network (or none). Existing connections drop. */
  moveTo(subnet: string | null, kind: NetworkKind = subnet ? 'wifi' : 'none'): void {
    this.subnet = subnet;
    this.kind = kind;
    for (const connection of [...this.connections]) connection.close('network changed');
    this.network.refreshVisibility();
    const snapshot = this.snapshot();
    for (const listener of [...this.networkListeners]) listener(snapshot);
  }

  /** Simulates the app being closed: stops listening/advertising and drops connections. */
  goOffline(): void {
    this.listening = null;
    this.advertisement = null;
    for (const connection of [...this.connections]) connection.close('app closed');
    this.network.refreshVisibility();
  }

  private listen(
    preferredPort: number,
    onConnection: (connection: TransportConnection) => void,
  ): Promise<Result<Listener, AppError>> {
    if (this.failListen) {
      return Promise.resolve(err(appError('PORT_IN_USE', 'simulated', { port: preferredPort })));
    }
    this.listening = { port: preferredPort, onConnection };
    return Promise.resolve(
      ok({
        port: preferredPort,
        close: () => {
          this.listening = null;
          return Promise.resolve();
        },
      }),
    );
  }

  private advertise(advertisement: Advertisement): Promise<Result<Advertiser, AppError>> {
    this.advertisement = advertisement;
    this.network.refreshVisibility();
    return Promise.resolve(
      ok({
        update: (next) => {
          this.advertisement = next;
          this.network.refreshVisibility(true);
          return Promise.resolve();
        },
        stop: () => {
          this.advertisement = null;
          this.network.refreshVisibility();
          return Promise.resolve();
        },
      }),
    );
  }

  private browse(listener: DiscoveryListener): Promise<Result<Unsubscribe, AppError>> {
    if (this.browseError) return Promise.resolve(err(this.browseError));
    const entry: BrowserEntry = { listener, visible: new Set() };
    this.browsers.add(entry);
    later(() => {
      this.network.refreshVisibility();
    });
    return Promise.resolve(
      ok(() => {
        this.browsers.delete(entry);
      }),
    );
  }
}

export class InMemoryNetwork {
  readonly nodes = new Map<string, NetworkNode>();
  private readonly blockedLinks = new Set<string>();

  createNode(host: string, options: NodeOptions): NetworkNode {
    if (this.nodes.has(host)) throw new Error(`node ${host} already exists`);
    const node = new NetworkNode(host, options, this);
    this.nodes.set(host, node);
    return node;
  }

  /** Drops all traffic between two hosts (firewall / Wi-Fi isolation). */
  block(a: string, b: string): void {
    this.blockedLinks.add(linkKey(a, b));
  }

  unblock(a: string, b: string): void {
    this.blockedLinks.delete(linkKey(a, b));
  }

  isBlocked(a: string, b: string): boolean {
    return this.blockedLinks.has(linkKey(a, b));
  }

  dial(
    from: NetworkNode,
    address: PeerAddress,
    _timeoutMs: number,
  ): Promise<Result<TransportConnection, AppError>> {
    // Nodes are reachable by name or by their simulated IPv4 address (e.g. from a QR code).
    const target =
      this.nodes.get(address.host) ??
      [...this.nodes.values()].find((node) => node.ipv4 === address.host);
    const fail = (cause: PeerUnreachableCause): Promise<Result<never, AppError>> =>
      Promise.resolve(
        err(
          appError('PEER_UNREACHABLE', `cannot reach ${address.host}: ${cause}`, {
            peerId: null,
            peerName: null,
            address: `${address.host}:${address.port}`,
            cause,
          }),
        ),
      );

    if (!from.subnet || !target?.subnet || target.subnet !== from.subnet)
      return fail('unreachable');
    if (this.isBlocked(from.host, target.host)) return fail('timeout');
    const listening = target.listening;
    if (listening?.port !== address.port) return fail('refused');

    const client = new MemoryConnection(
      `${target.host}:${address.port}`,
      this,
      from.host,
      target.host,
    );
    const server = new MemoryConnection(`${from.host}:0`, this, target.host, from.host);
    client.peer = server;
    server.peer = client;
    from.connections.add(client);
    target.connections.add(server);
    client.onClose(() => from.connections.delete(client));
    server.onClose(() => target.connections.delete(server));
    later(() => {
      listening.onConnection(server);
    });
    return Promise.resolve(ok(client));
  }

  /** Recomputes which advertisements each browser can see and emits up/down events. */
  refreshVisibility(forceUp = false): void {
    for (const node of this.nodes.values()) {
      for (const browser of node.browsers) {
        const nowVisible = new Map<string, DiscoveredService>();
        if (node.subnet) {
          for (const other of this.nodes.values()) {
            const ad = other.advertisement;
            if (!ad || other.subnet !== node.subnet) continue;
            const service = toService(other, ad);
            nowVisible.set(service.instanceId, service);
          }
        }
        for (const instanceId of [...browser.visible]) {
          if (!nowVisible.has(instanceId)) {
            browser.visible.delete(instanceId);
            browser.listener.onDown(instanceId);
          }
        }
        for (const [instanceId, service] of nowVisible) {
          if (browser.visible.has(instanceId) && !forceUp) continue;
          browser.visible.add(instanceId);
          browser.listener.onUp(service);
        }
      }
    }
  }
}

function toService(node: NetworkNode, ad: Advertisement): DiscoveredService {
  return {
    instanceId: `${node.host}._clipbridge._tcp`,
    deviceId: ad.deviceId,
    groupTag: ad.groupTag,
    pairingMode: ad.pairingMode,
    protocolVersion: ad.protocolVersion,
    addresses: [{ host: node.host, port: ad.port }],
  };
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
