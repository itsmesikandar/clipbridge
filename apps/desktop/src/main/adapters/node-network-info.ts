import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

import {
  type LocalNetworkPermission,
  type NetworkInfoPort,
  type NetworkKind,
  type NetworkSnapshot,
  prefixLengthFromNetmask,
  subnetOf,
  type Unsubscribe,
} from '@clipbridge/core';

/** Adapters that are not the user's real LAN (VMs, containers, VPNs). */
const VIRTUAL_INTERFACE =
  /(vEthernet|Hyper-V|VirtualBox|VMware|vmnet|vboxnet|WSL|docker|br-|veth|utun|tun\d|tap\d|ZeroTier|Tailscale|Hamachi|Loopback|awdl|llw|bridge)/i;

const WIFI_INTERFACE = /(wi-?fi|wlan|wireless|airport|^en0$)/i;
const ETHERNET_INTERFACE = /(ethernet|^eth\d|^en\d+$)/i;

const POLL_INTERVAL_MS = 5_000;

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

function isPrivateIpv4(address: string): boolean {
  return (
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function kindOf(name: string): NetworkKind {
  if (WIFI_INTERFACE.test(name)) return 'wifi';
  if (ETHERNET_INTERFACE.test(name)) return 'ethernet';
  return 'unknown';
}

/**
 * Picks the interface peers can reach: non-internal IPv4, not virtual, private
 * ranges first, Wi-Fi/Ethernet before unknown names.
 */
export function pickLanSnapshot(interfaces: InterfaceMap): NetworkSnapshot {
  const candidates: { name: string; info: NetworkInterfaceInfo; score: number }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || VIRTUAL_INTERFACE.test(name)) continue;
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue;
      const kind = kindOf(name);
      const score =
        (isPrivateIpv4(info.address) ? 10 : 0) +
        (kind === 'unknown' ? 0 : 5) +
        (kind === 'wifi' ? 1 : 0);
      candidates.push({ name, info, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { kind: 'none', ipv4: null, subnet: null };

  const prefix = best.info.cidr
    ? Number(best.info.cidr.split('/')[1])
    : prefixLengthFromNetmask(best.info.netmask);
  return {
    kind: kindOf(best.name),
    ipv4: best.info.address,
    subnet: prefix === null || Number.isNaN(prefix) ? null : subnetOf(best.info.address, prefix),
  };
}

/** Reads the LAN address from the OS and polls for changes (Wi-Fi switch, cable, sleep). */
export class NodeNetworkInfo implements NetworkInfoPort {
  private snapshot: NetworkSnapshot;
  private readonly listeners = new Set<(snapshot: NetworkSnapshot) => void>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly readInterfaces: () => InterfaceMap = networkInterfaces) {
    this.snapshot = pickLanSnapshot(this.readInterfaces());
  }

  current(): Promise<NetworkSnapshot> {
    this.refresh();
    return Promise.resolve(this.snapshot);
  }

  onChange(listener: (snapshot: NetworkSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    this.timer ??= setInterval(() => {
      this.refresh();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  localNetworkPermission(): Promise<LocalNetworkPermission> {
    return Promise.resolve('granted');
  }

  /** Re-reads interfaces now (e.g. after the system resumes from sleep). */
  refresh(): void {
    const next = pickLanSnapshot(this.readInterfaces());
    const previous = this.snapshot;
    if (
      next.kind === previous.kind &&
      next.ipv4 === previous.ipv4 &&
      next.subnet === previous.subnet
    )
      return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
