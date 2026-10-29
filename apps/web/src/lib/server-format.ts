import type { PetriNet } from '@pnm/core';
import type { VersionInfo } from './server-api';

/** A time as the person's browser writes it. */
export function formatWhen(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Element counts of a version compared with the net in the editor: `+2`, `−1` or nothing. */
export function compareCounts(
  version: Pick<VersionInfo, 'places' | 'transitions' | 'arcs'>,
  net: Pick<PetriNet, 'places' | 'transitions' | 'arcs'>,
): { places: number; transitions: number; arcs: number } {
  return {
    places: version.places - net.places.length,
    transitions: version.transitions - net.transitions.length,
    arcs: version.arcs - net.arcs.length,
  };
}
