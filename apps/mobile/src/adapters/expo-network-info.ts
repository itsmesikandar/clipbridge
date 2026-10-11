import {
  type LocalNetworkPermission,
  type NetworkInfoPort,
  type NetworkKind,
  type NetworkSnapshot,
  subnetOf,
  type Unsubscribe,
} from '@clipbridge/core';
import * as Network from 'expo-network';

import { getLanInterfaces, type LanInterface } from '../../modules/sync-service';

/** expo-network does not expose the netmask; home and office Wi-Fi almost always use /24. */
const ASSUMED_PREFIX = 24;
const POLL_INTERVAL_MS = 10_000;

function isPrivateIpv4(address: string): boolean {
  return (
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

/** Wi-Fi first, then the phone's own hotspot, then wired / USB tethering. */
const LAN_INTERFACES: readonly { readonly pattern: RegExp; readonly kind: NetworkKind }[] = [
  { pattern: /^wlan\d+$/, kind: 'wifi' },
  { pattern: /^(ap|swlan)\d+$/, kind: 'wifi' },
  { pattern: /^(eth|rndis|usb)\d+$/, kind: 'ethernet' },
];

/**
 * Picks the interface other devices can reach. Sees the phone's hotspot, which
 * the Wi-Fi API reports as "cellular". Mobile data and VPN interfaces are ignored.
 */
export function pickLanInterface(interfaces: readonly LanInterface[]): NetworkSnapshot | null {
  for (const { pattern, kind } of LAN_INTERFACES) {
    const match = interfaces.find(
      (entry) => pattern.test(entry.name) && isPrivateIpv4(entry.address),
    );
    if (match) return { kind, ipv4: match.address, subnet: subnetOf(match.address, match.prefix) };
  }
  return null;
}

export function toNetworkKind(type: Network.NetworkStateType | undefined): NetworkKind {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.ETHERNET:
      return 'ethernet';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case Network.NetworkStateType.NONE:
      return 'none';
    default:
      return 'unknown';
  }
}

export function toSnapshot(kind: NetworkKind, ip: string | null): NetworkSnapshot {
  const usable = ip && ip !== '0.0.0.0' && !ip.startsWith('127.') ? ip : null;
  const onLan = kind === 'wifi' || kind === 'ethernet' || kind === 'unknown';
  return {
    kind,
    ipv4: onLan ? usable : null,
    subnet: onLan && usable ? subnetOf(usable, ASSUMED_PREFIX) : null,
  };
}

export class ExpoNetworkInfo implements NetworkInfoPort {
  private last: NetworkSnapshot | null = null;

  constructor(private readonly permission: () => Promise<LocalNetworkPermission>) {}

  async current(): Promise<NetworkSnapshot> {
    const lan = pickLanInterface(getLanInterfaces() ?? []);
    if (lan) {
      this.last = lan;
      return lan;
    }
    const [state, ip] = await Promise.all([
      Network.getNetworkStateAsync(),
      Network.getIpAddressAsync().catch(() => null),
    ]);
    this.last = toSnapshot(state.isConnected === false ? 'none' : toNetworkKind(state.type), ip);
    return this.last;
  }

  onChange(listener: (snapshot: NetworkSnapshot) => void): Unsubscribe {
    const check = (): void => {
      const previous = this.last;
      void this.current().then((snapshot) => {
        if (
          previous?.kind !== snapshot.kind ||
          previous.ipv4 !== snapshot.ipv4 ||
          previous.subnet !== snapshot.subnet
        ) {
          listener(snapshot);
        }
      });
    };
    const subscription = Network.addNetworkStateListener(check);
    // Hotspot and tethering changes do not always fire the listener above.
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }

  localNetworkPermission(): Promise<LocalNetworkPermission> {
    return this.permission();
  }
}
