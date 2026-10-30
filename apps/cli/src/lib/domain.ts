import type { PetriNet } from '@pnm/core';
import {
  genericDomainViewWithLayout,
  validateDomainView,
  type DomainDiagnostic,
  type DomainView,
} from '@pnm/domain';

export interface DomainCheck {
  ok: boolean;
  errors: number;
  warnings: number;
  diagnostics: DomainDiagnostic[];
}

/** Checks a domain view (rules V1 to V9) against the net. */
export function checkDomainView(net: PetriNet, view: unknown): DomainCheck {
  const result = validateDomainView(net, view);
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  return {
    ok: result.ok,
    errors,
    warnings: result.diagnostics.length - errors,
    diagnostics: result.diagnostics,
  };
}

/** The result of `pnm domain check --json`, without the name of the file. */
export function domainCheckJson(check: DomainCheck): Record<string, unknown> {
  return {
    ok: check.ok,
    errors: check.errors,
    warnings: check.warnings,
    diagnostics: check.diagnostics,
  };
}

/** The net with a new domain view; a record of an earlier generation no longer describes it. */
export function netWithGenericView(net: PetriNet, view: DomainView): PetriNet {
  const { domainViewGeneration: _record, ...rest } = net;
  return { ...rest, domainView: view };
}

/** A generic domain view (stations where the net has its nodes), laid out like the editor does. */
export const genericView = genericDomainViewWithLayout;
