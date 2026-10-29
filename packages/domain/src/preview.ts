import type { Id, PetriNet } from '@pnm/core';
import { arcKey, type DomainView } from './schema';
import { LAYERS, type DrawCommand, type Layer, type Scene } from './scene';

/** What a drag in the mode "Edit layout" changes: the places, transitions and arcs of the net by id, and pieces of decor by index. */
export interface MovedEntries {
  elements: Set<Id>;
  decor: Set<number>;
}

export function emptyMoved(): MovedEntries {
  return { elements: new Set(), decor: new Set() };
}

/**
 * The entries that differ between two views of the same net, compared by identity: the edits of
 * `edit.ts` build new objects only for what they change, so a preview shares every other entry
 * with the view it was made from.
 */
export function movedEntries(net: PetriNet, base: DomainView, next: DomainView): MovedEntries {
  const moved = emptyMoved();
  for (const place of net.places) {
    if (base.places[place.id] !== next.places[place.id]) moved.elements.add(place.id);
  }
  for (const transition of net.transitions) {
    if (base.transitions[transition.id] !== next.transitions[transition.id]) {
      moved.elements.add(transition.id);
    }
  }
  for (const arc of net.arcs) {
    const key = arcKey(arc.source, arc.target);
    if (base.arcs?.[key] !== next.arcs?.[key]) moved.elements.add(arc.id);
  }
  const before = base.decor ?? [];
  const after = next.decor ?? [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    if (before[i] !== after[i]) moved.decor.add(i);
  }
  return moved;
}

/** Adds the entries of `more` to `into`. Returns true if `into` grew. */
export function mergeMoved(into: MovedEntries, more: MovedEntries): boolean {
  let grew = false;
  for (const id of more.elements) {
    if (!into.elements.has(id)) {
      into.elements.add(id);
      grew = true;
    }
  }
  for (const index of more.decor) {
    if (!into.decor.has(index)) {
      into.decor.add(index);
      grew = true;
    }
  }
  return grew;
}

function belongsTo(command: DrawCommand, moved: MovedEntries): boolean {
  if (command.elementId !== undefined && moved.elements.has(command.elementId)) return true;
  return command.decor !== undefined && moved.decor.has(command.decor);
}

/** The scene without the commands of the moved entries (the part of a drag that stays put). */
export function sceneWithout(scene: Scene, moved: MovedEntries): Scene {
  const layers = {} as Record<Layer, DrawCommand[]>;
  for (const layer of LAYERS)
    layers[layer] = scene.layers[layer].filter((c) => !belongsTo(c, moved));
  return { ...scene, layers };
}

/** The commands of the moved entries only, by layer (the part of a drag that follows the pointer). */
export function sceneOnly(scene: Scene, moved: MovedEntries): Record<Layer, DrawCommand[]> {
  const layers = {} as Record<Layer, DrawCommand[]>;
  for (const layer of LAYERS)
    layers[layer] = scene.layers[layer].filter((c) => belongsTo(c, moved));
  return layers;
}
