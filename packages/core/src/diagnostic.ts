import type { Id } from './model';

export type Severity = 'error' | 'warning';

export type DiagnosticCode =
  // Structure (P/T nets and JSON nets)
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'ARC_DANGLING'
  | 'ARC_NOT_BIPARTITE'
  | 'ARC_WEIGHT_INVALID'
  | 'CAPACITY_INVALID'
  | 'MARKING_UNKNOWN_PLACE'
  | 'MARKING_EXCEEDS_CAPACITY'
  | 'DUPLICATE_NAME'
  | 'ISOLATED_NODE'
  | 'MULTIPLE_ARCS'
  // Types, inscriptions and guards (JSON nets)
  | 'TYPE_UNKNOWN'
  | 'TYPE_SCHEMA_INVALID'
  | 'TYPE_NAME_INVALID'
  | 'TYPE_UNUSED'
  | 'TOKEN_TYPE_MISMATCH'
  | 'INSCRIPTION_SYNTAX'
  | 'GUARD_SYNTAX'
  | 'VARIABLE_UNBOUND'
  | 'WEIGHT_IGNORED'
  | 'INSCRIPTION_ON_PT_NET'
  // Raised while computing bindings
  | 'GUARD_ERROR'
  | 'INSCRIPTION_ERROR';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  elementId?: Id;
  /** Name of the type the diagnostic is about (type diagnostics have no element). */
  typeName?: string;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
