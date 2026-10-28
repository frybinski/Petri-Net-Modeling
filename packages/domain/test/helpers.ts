import { createEmptyNet, type PetriNet } from '@pnm/core';
import { netHash, type DomainView } from '../src';

/**
 * A small net: arrivals (`t_in`) fill a queue (`q`), `work` needs a worker (`res`, a resource that
 * is taken and given back) and puts the finished cases on `done`.
 */
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

/** A valid view of `smallNet()` without errors and warnings. */
export function smallView(net: PetriNet = smallNet()): DomainView {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: 'Test',
      viewName: 'Hall',
      entity: { singular: 'Parcel', plural: 'Parcels', sprite: 'parcel' },
      canvas: { width: 800, height: 400 },
    },
    places: {
      q: {
        kind: 'conveyor',
        path: [
          [100, 200],
          [300, 200],
        ],
      },
      res: { kind: 'slots', of: 'work' },
      done: { kind: 'sink', box: [600, 180, 80, 40] },
    },
    transitions: {
      t_in: { kind: 'dock', pos: [50, 200] },
      work: { kind: 'station', box: [320, 160, 100, 80], slots: [[370, 200]] },
    },
    arcs: {
      'work>done': {
        path: [
          [420, 200],
          [600, 200],
        ],
      },
    },
    decor: [{ kind: 'label', pos: [20, 30], text: 'Test hall' }],
    provenance: {
      'places.q': { source: 'user', at },
      'transitions.work': { source: 'user', at },
    },
  };
}
