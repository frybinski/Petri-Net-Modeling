import { isCaselessRole, type Id, type PlaceRole } from '@pnm/core';
import type { Appearance, DomainView } from './schema';

/**
 * How cases look (N2). A case is drawn with the `appearance` of the place it lies on; where a
 * place has none, with the entity of the view. Inside a firing it keeps the look of the place it
 * was taken from, and takes that of the place it is put on when the firing completes.
 */

/** What the look of a case inside a firing is looked up from: the roles and the arcs of a net. */
export interface AppearanceContext {
  view: DomainView;
  roles: ReadonlyMap<Id, PlaceRole>;
  /** Input and output places of every transition, in the order of the arcs. */
  inputs: ReadonlyMap<Id, readonly Id[]>;
  outputs: ReadonlyMap<Id, readonly Id[]>;
}

const defaultAppearances = new WeakMap<DomainView, Appearance>();

/** How cases look on a place without an `appearance`: the entity of the view. */
export function defaultAppearance(view: DomainView): Appearance {
  let known = defaultAppearances.get(view);
  if (!known) {
    known = { sprite: view.meta.entity.sprite };
    defaultAppearances.set(view, known);
  }
  return known;
}

/** How the cases on a place look: its `appearance`, else the entity of the view. */
export function appearanceOfPlace(view: DomainView, placeId: Id): Appearance {
  const entry = view.places[placeId];
  if (entry !== undefined && 'appearance' in entry && entry.appearance !== undefined) {
    return entry.appearance;
  }
  return defaultAppearance(view);
}

/** True if two appearances draw the same picture. */
export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return a === b || (a.sprite === b.sprite && a.tint === b.tint);
}

/**
 * How the case with the given index looks while a firing of the transition holds it: like the case
 * place it was taken from (the cases of a firing are in the order of its input places). A
 * transition without a case input, an arrival, shows the case as it will look on the place it is
 * put on.
 */
export function heldAppearance(
  ctx: AppearanceContext,
  transitionId: Id,
  index: number,
): Appearance {
  const caseInputs = (ctx.inputs.get(transitionId) ?? []).filter(
    (id) => !isCaselessRole(ctx.roles.get(id)),
  );
  const from = caseInputs[Math.min(Math.max(0, index), caseInputs.length - 1)];
  if (from !== undefined) return appearanceOfPlace(ctx.view, from);
  const to = (ctx.outputs.get(transitionId) ?? []).find((id) => !isCaselessRole(ctx.roles.get(id)));
  return to !== undefined ? appearanceOfPlace(ctx.view, to) : defaultAppearance(ctx.view);
}
