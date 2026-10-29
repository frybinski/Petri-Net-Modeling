import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';

const here = dirname(fileURLToPath(import.meta.url));

/** An example net of the repository by file name without extension. */
export function example(name: string): PetriNet {
  return parseNetText(
    readFileSync(join(here, '..', '..', '..', 'examples', `${name}.pn.json`), 'utf8'),
  );
}

export interface NetSpec {
  /** `[name, initial tokens, capacity]`; the id of a place is its name. */
  places: Array<[string, number?, number?]>;
  /** Names of the transitions; the id of a transition is its name. */
  transitions: string[];
  /** `[source, target, weight]` with names. */
  arcs: Array<[string, string, number?]>;
}

/** A P/T net from a compact description; ids equal names. */
export function ptNet(spec: NetSpec, name = 'test'): PetriNet {
  const net = createEmptyNet(name, 'pt-net');
  for (const [id, tokens, capacity] of spec.places) {
    net.places.push({
      id,
      name: id,
      position: { x: 0, y: 0 },
      ...(capacity !== undefined && { capacity }),
    });
    if (tokens) net.marking[id] = Array.from({ length: tokens }, () => 1);
  }
  for (const id of spec.transitions) {
    net.transitions.push({ id, name: id, position: { x: 0, y: 0 } });
  }
  spec.arcs.forEach(([source, target, weight], index) => {
    net.arcs.push({ id: `a${index}`, source, target, weight: weight ?? 1 });
  });
  return net;
}
