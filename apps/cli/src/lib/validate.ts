import { validate, type Diagnostic, type PetriNet } from '@pnm/core';
import { validateDomainView, type DomainDiagnostic } from '@pnm/domain';
import type { LoadedNet } from './net-text';

export interface NetCheck {
  core: Diagnostic[];
  /** `undefined` if the net has no domain view. */
  domain: ReturnType<typeof validateDomainView> | undefined;
  domainDiagnostics: DomainDiagnostic[];
  errors: number;
  warnings: number;
}

/** Checks a net and, if it has one, its domain view. */
export function checkNet(net: PetriNet): NetCheck {
  const core = validate(net);
  const domain = net.domainView === undefined ? undefined : validateDomainView(net, net.domainView);
  const domainDiagnostics = domain?.diagnostics ?? [];
  const count = (severity: 'error' | 'warning'): number =>
    core.filter((d) => d.severity === severity).length +
    domainDiagnostics.filter((d) => d.severity === severity).length;
  return {
    core,
    domain,
    domainDiagnostics,
    errors: count('error'),
    warnings: count('warning'),
  };
}

/** The result of `pnm validate --json`, without the name of the file. */
export function validationJson(loaded: LoadedNet, check: NetCheck): Record<string, unknown> {
  const { net } = loaded;
  const { core, domain, domainDiagnostics } = check;
  return {
    ok: check.errors === 0,
    errors: check.errors,
    warnings: check.warnings,
    places: net.places.length,
    transitions: net.transitions.length,
    arcs: net.arcs.length,
    importWarnings: loaded.importWarnings,
    diagnostics: core.map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      ...(d.elementId !== undefined && { elementId: d.elementId }),
      ...(d.typeName !== undefined && { typeName: d.typeName }),
      ...(d.path !== undefined && { path: d.path }),
    })),
    domainView:
      domain === undefined
        ? { present: false }
        : {
            present: true,
            ok: domain.ok,
            diagnostics: domainDiagnostics.map((d) => ({
              rule: d.rule,
              severity: d.severity,
              path: d.path,
              message: d.message,
              ...(d.elementId !== undefined && { elementId: d.elementId }),
            })),
          },
  };
}
