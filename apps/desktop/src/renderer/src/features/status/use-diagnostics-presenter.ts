import { useCallback, useEffect, useState } from 'react';

import type { ClipBridgeApi, DiagnosticsView } from '../../../../shared/ipc-contract';

export interface DiagnosticsPresenter {
  readonly diagnostics: DiagnosticsView | null;
  readonly refresh: () => void;
  /** Plain-text report without keys or clip contents, for sharing when asking for help. */
  readonly report: string | null;
}

export function useDiagnosticsPresenter(
  api: Pick<ClipBridgeApi, 'getDiagnostics'>,
): DiagnosticsPresenter {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsView | null>(null);

  const refresh = useCallback(() => {
    void api.getDiagnostics().then(setDiagnostics);
  }, [api]);

  useEffect(refresh, [refresh]);

  return { diagnostics, refresh, report: diagnostics ? toReport(diagnostics) : null };
}

export function toReport(d: DiagnosticsView): string {
  const lines = [
    `ClipBridge ${d.appVersion} (core ${d.coreVersion}, protocol v${d.protocolVersion})`,
    `Device: ${d.deviceName} [${d.deviceId}] on ${d.platform}`,
    `Network: ${d.network ? `${d.network.kind}, ${d.network.ipv4 ?? 'no IP'}, ${d.network.subnet ?? 'no subnet'}` : 'unknown'}`,
    `Listening port: ${d.listenPort ?? 'not listening'}`,
    `Devices:`,
    ...d.devices.map(
      (peer) =>
        `  - ${peer.name} (${peer.platform}): ${peer.state}${peer.discovered ? ', discovered' : ''}` +
        (peer.lastSeenSubnet ? `, last subnet ${peer.lastSeenSubnet}` : '') +
        (peer.lastError ? `, last error ${peer.lastError.code}` : ''),
    ),
    `Log file: ${d.logFile}`,
  ];
  return lines.join('\n');
}
