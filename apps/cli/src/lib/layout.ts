import type { PetriNet } from '@pnm/core';
import { layoutNet } from '@pnm/layout';
import { GRID_SIZE, snap } from '@pnm/layout/geometry';

export interface LayoutSettings {
  direction?: 'RIGHT' | 'DOWN';
  spacing?: number;
}

/**
 * The net with new positions for all places and transitions (ELK, layered), snapped to the grid of
 * the editor; bend points of arcs are removed. Throws if the layout engine fails.
 */
export async function laidOutNet(net: PetriNet, settings: LayoutSettings = {}): Promise<PetriNet> {
  const raw = await layoutNet(net, {
    ...(settings.direction !== undefined && { direction: settings.direction }),
    ...(settings.spacing !== undefined && { spacing: settings.spacing }),
  });
  const place = (id: string, fallback: { x: number; y: number }): { x: number; y: number } => {
    const p = raw[id];
    return p ? { x: snap(p.x, GRID_SIZE / 2), y: snap(p.y, GRID_SIZE / 2) } : fallback;
  };
  return {
    ...net,
    places: net.places.map((p) => ({ ...p, position: place(p.id, p.position) })),
    transitions: net.transitions.map((t) => ({ ...t, position: place(t.id, t.position) })),
    arcs: net.arcs.map(({ points: _points, ...arc }) => arc),
  };
}
