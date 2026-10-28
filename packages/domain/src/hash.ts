import type { PetriNet } from '@pnm/core';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a, 64 bits, over the UTF-16 code units of the text. */
function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash;
}

/**
 * A fingerprint of the structure of a net: the ids of its places and transitions and its arcs
 * (as `source>target`). Names, positions, markings and inscriptions do not enter, so renaming or
 * moving elements keeps a domain view up to date while adding or removing elements does not.
 *
 * It only detects stale views, it is not meant to be secure. Synchronous on purpose.
 */
export function netHash(net: PetriNet): string {
  const places = net.places.map((p) => p.id).sort();
  const transitions = net.transitions.map((t) => t.id).sort();
  const arcs = net.arcs.map((a) => `${a.source}>${a.target}`).sort();
  const text = `P\u0001${places.join('\u0002')}\u0003T\u0001${transitions.join('\u0002')}\u0003A\u0001${arcs.join('\u0002')}`;
  return `fnv1a64:${fnv1a64(text).toString(16).padStart(16, '0')}`;
}
