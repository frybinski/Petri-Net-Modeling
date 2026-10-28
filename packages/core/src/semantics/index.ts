import type { Id, Marking, PetriNet, Token } from '../model';
import {
  enabledTransitionsHigher,
  type BindingOptions,
  type BindingResult,
  type EnabledBinding,
  type EnabledResult,
} from './json-net';
import { enabledTransitions as enabledPt } from './pt';

export { enabledTransitions, fire, isEnabled } from './pt';
export {
  DEFAULT_MAX_BINDINGS,
  DEFAULT_MAX_CANDIDATES,
  computeBindings,
  enabledTransitionsHigher,
  fireBinding,
  type Binding,
  type BindingOptions,
  type BindingResult,
  type EnabledBinding,
  type EnabledResult,
} from './json-net';

/**
 * The enabled bindings of a P/T net: one binding without variables per enabled transition.
 * Synchronous, unlike `findEnabled`, which defers to it for P/T nets.
 */
export function findEnabledPt(net: PetriNet, marking: Marking): EnabledResult {
  const enabled = new Map<Id, BindingResult>();
  const placeIds = new Set(net.places.map((p) => p.id));
  for (const transitionId of enabledPt(net, marking)) {
    const consumed = new Map<Id, number>();
    const produced = new Map<Id, number>();
    for (const arc of net.arcs) {
      if (arc.target === transitionId && placeIds.has(arc.source)) {
        consumed.set(arc.source, (consumed.get(arc.source) ?? 0) + arc.weight);
      } else if (arc.source === transitionId && placeIds.has(arc.target)) {
        produced.set(arc.target, (produced.get(arc.target) ?? 0) + arc.weight);
      }
    }
    const consumes: Record<Id, Token[]> = {};
    for (const [placeId, count] of consumed)
      consumes[placeId] = (marking[placeId] ?? []).slice(0, count);
    const produces: Record<Id, Token[]> = {};
    for (const [placeId, count] of produced)
      produces[placeId] = Array.from({ length: count }, () => 1);
    const binding: EnabledBinding = { transitionId, binding: {}, consumes, produces };
    enabled.set(transitionId, { bindings: [binding], truncated: false, diagnostics: [] });
  }
  return { enabled, diagnostics: [] };
}

/**
 * Finds the enabled transitions of a net together with their bindings, using the firing rule of
 * the net's profile. P/T nets yield one empty binding per enabled transition. Fire the chosen
 * binding with `fireBinding`.
 */
export async function findEnabled(
  net: PetriNet,
  marking: Marking,
  opts?: BindingOptions,
): Promise<EnabledResult> {
  if (net.profile === 'pt-net') return findEnabledPt(net, marking);
  return enabledTransitionsHigher(net, marking, opts);
}
