import { toReport } from '@clipbridge/app/presentation';
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
