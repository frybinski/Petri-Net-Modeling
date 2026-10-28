import type { Diagnostic } from '@pnm/core';
import { useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';

/**
 * Validation results of the document plus, while simulating, the problems found when evaluating
 * guards and inscriptions.
 */
export function useDiagnostics(): Diagnostic[] {
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const simDiagnostics = useEditorStore((s) => s.simDiagnostics);
  const simulating = useEditorStore((s) => s.mode === 'simulate');
  return useMemo(
    () =>
      simulating && simDiagnostics.length > 0 ? [...diagnostics, ...simDiagnostics] : diagnostics,
    [diagnostics, simDiagnostics, simulating],
  );
}
