export type NetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'none' | 'unknown';

/** What a device knows about its own network connection. */
export interface NetworkSnapshot {
  readonly kind: NetworkKind;
  readonly ipv4: string | null;
  /** CIDR, e.g. `192.168.1.0/24`. */
  readonly subnet: string | null;
}

/** True when the device has a LAN address that peers could reach. */
export function hasLanConnection(snapshot: NetworkSnapshot): boolean {
  if (snapshot.kind === 'none' || snapshot.kind === 'cellular') return false;
  return snapshot.ipv4 !== null && !snapshot.ipv4.startsWith('127.');
}

export function parseIpv4(address: string): readonly [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return null;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/** `"255.255.255.0"` → 24. Returns null for invalid or non-contiguous masks. */
export function prefixLengthFromNetmask(netmask: string): number | null {
  const octets = parseIpv4(netmask);
  if (!octets) return null;
  const bits = octets.map((octet) => octet.toString(2).padStart(8, '0')).join('');
  if (!/^1*0*$/.test(bits)) return null;
  return !bits.includes('0') ? 32 : bits.indexOf('0');
}

/** `("192.168.1.42", 24)` → `"192.168.1.0/24"`. */
export function subnetOf(ipv4: string, prefixLength: number): string | null {
  const octets = parseIpv4(ipv4);
  if (!octets || prefixLength < 0 || prefixLength > 32) return null;
  const value = octets.reduce((acc, octet) => acc * 256 + octet, 0);
  const size = 2 ** (32 - prefixLength);
  const network = Math.floor(value / size) * size;
  const out = [24, 16, 8, 0].map((shift) => Math.floor(network / 2 ** shift) % 256);
  return `${out.join('.')}/${prefixLength}`;
}

/** Human-friendly subnet label: `"192.168.1.0/24"` → `"192.168.1.x"`; other prefixes stay CIDR. */
export function subnetLabel(subnet: string): string {
  const match = /^(\d+\.\d+\.\d+)\.0\/24$/.exec(subnet);
  return match?.[1] ? `${match[1]}.x` : subnet;
}
