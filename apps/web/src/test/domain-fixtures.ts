import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';

const root = join(import.meta.dirname, '..', '..', '..', '..');

/** One of the example nets of the repository. */
export function loadExample(name: string): PetriNet {
  return parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));
}

/** Arrivals -> queue -> work (needs a worker) -> done, without a domain view. */
export function smallNet(): PetriNet {
  const net = createEmptyNet('Small');
  net.places = [
    { id: 'q', name: 'Queue', position: { x: 200, y: 100 } },
    { id: 'res', name: 'Worker', position: { x: 360, y: 20 } },
    { id: 'done', name: 'Done', position: { x: 520, y: 100 } },
  ];
  net.transitions = [
    { id: 't_in', name: 'Arrive', position: { x: 80, y: 100 }, rate: 60 },
    { id: 'work', name: 'Work', position: { x: 360, y: 100 } },
  ];
  net.arcs = [
    { id: 'a1', source: 't_in', target: 'q', weight: 1 },
    { id: 'a2', source: 'q', target: 'work', weight: 1 },
    { id: 'a3', source: 'res', target: 'work', weight: 1 },
    { id: 'a4', source: 'work', target: 'res', weight: 1 },
    { id: 'a5', source: 'work', target: 'done', weight: 1 },
  ];
  net.marking = { res: [1] };
  return net;
}
