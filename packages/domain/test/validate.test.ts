import { describe, expect, it } from 'vitest';
import {
  domainViewJsonSchema,
  netHash,
  normalizeDomainView,
  validateDomainView,
  type DomainDiagnostic,
  type DomainRule,
  type DomainView,
} from '../src';
import { smallNet, smallView } from './helpers';

function rules(diagnostics: readonly DomainDiagnostic[]): DomainRule[] {
  return [...new Set(diagnostics.map((d) => d.rule))];
}

/** A copy of the valid view that `change` may modify freely. */
function mutated(change: (view: DomainView) => void): DomainView {
  const view = structuredClone(smallView());
  change(view);
  return view;
}

describe('validateDomainView', () => {
  it('accepts the reference view without any diagnostic', () => {
    const result = validateDomainView(smallNet(), smallView());
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.view?.meta.theme).toBe('Test');
  });

  // Acceptance A5: one example per rule that triggers exactly this rule.
  describe('A5: one triggering example per rule', () => {
    const net = smallNet();

    it('V1: a behaviour field is rejected by the schema (error)', () => {
      const view = mutated((v) => {
        Object.assign(v.transitions['work']!, { duration: 5 });
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V1']);
      expect(result.ok).toBe(false);
      expect(result.view).toBeUndefined();
      const first = result.diagnostics[0]!;
      expect(first.path).toBe('transitions.work.duration');
      expect(first.message).toMatch(/behaviour/);
      expect(first.elementId).toBe('work');
      expect(first.severity).toBe('error');
    });

    it('V1: wrong types carry the path of the problem', () => {
      const view = mutated((v) => {
        (v.places['q'] as { path: unknown }).path = [
          [1, 'x'],
          [2, 3],
        ];
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V1']);
      expect(result.diagnostics[0]!.path).toBe('places.q.path[0][1]');
    });

    it('V1: a value that is not an object is rejected', () => {
      expect(rules(validateDomainView(net, 'nope').diagnostics)).toEqual(['V1']);
      expect(rules(validateDomainView(net, null).diagnostics)).toEqual(['V1']);
    });

    it('V2: an entry for an element that does not exist (error)', () => {
      const view = mutated((v) => {
        v.places['ghost'] = { kind: 'hidden', reason: 'gone' };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V2']);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]!.path).toBe('places.ghost');
    });

    it('V2: an arc entry against the direction of the arc (error)', () => {
      const view = mutated((v) => {
        v.arcs = {
          'done>work': {
            path: [
              [600, 200],
              [420, 200],
            ],
          },
        };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V2']);
    });

    it('V2: a provenance key that names nothing (error)', () => {
      const view = mutated((v) => {
        v.provenance['places.ghost'] = { source: 'user', at: 'x' };
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V2']);
    });

    it('V3: a place without an entry (error)', () => {
      const view = mutated((v) => {
        delete v.places['done'];
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V3']);
      expect(result.diagnostics[0]!.elementId).toBe('done');
      expect(result.ok).toBe(false);
    });

    it('V3: a transition without an entry (error)', () => {
      const view = mutated((v) => {
        delete v.transitions['work'];
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V3']);
    });

    it('V3: a hidden entry counts as an entry', () => {
      const view = mutated((v) => {
        v.places['done'] = { kind: 'hidden', reason: 'not interesting' };
      });
      expect(validateDomainView(net, view).diagnostics).toEqual([]);
    });

    it('V4: a resource place drawn as a conveyor (error)', () => {
      const view = mutated((v) => {
        v.places['res'] = {
          kind: 'conveyor',
          path: [
            [100, 300],
            [300, 300],
          ],
        };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V4']);
      expect(result.diagnostics[0]!.elementId).toBe('res');
    });

    it('V4: a case place drawn as slots (error)', () => {
      const view = mutated((v) => {
        v.places['q'] = { kind: 'slots', of: 'work' };
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V4']);
    });

    it('V4: a sink place drawn as a queue (error)', () => {
      const view = mutated((v) => {
        v.places['done'] = {
          kind: 'queue',
          path: [
            [500, 300],
            [700, 300],
          ],
        };
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V4']);
    });

    it('V4: an arrival transition drawn as a station (error)', () => {
      const view = mutated((v) => {
        v.transitions['t_in'] = { kind: 'station', box: [20, 160, 60, 80] };
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V4']);
    });

    it('V4: slots of a transition the place forms no loop with (error)', () => {
      const view = mutated((v) => {
        v.places['res'] = { kind: 'slots', of: 't_in' };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V4']);
      expect(result.diagnostics[0]!.path).toBe('places.res.of');
    });

    it('V4: honours the role override of a place', () => {
      const overridden = smallNet();
      overridden.places[1]!.role = 'case';
      const view = mutated((v) => {
        v.places['res'] = {
          kind: 'queue',
          path: [
            [100, 300],
            [300, 300],
          ],
        };
        v.netHash = netHash(overridden);
      });
      expect(validateDomainView(overridden, view).diagnostics).toEqual([]);
    });

    it('V5: a point outside the canvas (error)', () => {
      const view = mutated((v) => {
        v.places['done'] = { kind: 'sink', box: [760, 180, 80, 40] };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V5']);
      expect(result.diagnostics[0]!.path).toBe('places.done.box');
    });

    it('V5: a path of one point or without length (error)', () => {
      const one = mutated((v) => {
        v.places['q'] = { kind: 'conveyor', path: [[100, 200]] };
      });
      expect(rules(validateDomainView(net, one).diagnostics)).toEqual(['V5']);
      const none = mutated((v) => {
        v.places['q'] = {
          kind: 'conveyor',
          path: [
            [100, 200],
            [100, 200],
          ],
        };
      });
      expect(rules(validateDomainView(net, none).diagnostics)).toContain('V5');
    });

    it('V5: a rectangle without area (error)', () => {
      const view = mutated((v) => {
        v.places['done'] = { kind: 'sink', box: [600, 180, 0, 40] };
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V5']);
    });

    it('V5: a slot outside the box of its transition (error)', () => {
      const view = mutated((v) => {
        v.transitions['work'] = { kind: 'station', box: [320, 160, 100, 80], slots: [[500, 200]] };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V5']);
      expect(result.diagnostics[0]!.path).toBe('transitions.work.slots[0]');
    });

    it('V5: decor outside the canvas (error)', () => {
      const view = mutated((v) => {
        v.decor = [{ kind: 'room', rect: [700, 300, 200, 200] }];
      });
      expect(rules(validateDomainView(net, view).diagnostics)).toEqual(['V5']);
    });

    it('V6: fewer slots than the initial resources (warning)', () => {
      const withTwo = smallNet();
      withTwo.marking = { res: [1, 1] };
      const view = smallView(withTwo);
      const result = validateDomainView(withTwo, view);
      expect(rules(result.diagnostics)).toEqual(['V6']);
      expect(result.diagnostics[0]!.severity).toBe('warning');
      expect(result.ok).toBe(true);
    });

    it('V6: a queue that is too short for ten tokens (warning)', () => {
      const view = mutated((v) => {
        v.places['q'] = {
          kind: 'queue',
          path: [
            [100, 200],
            [200, 200],
          ],
        };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V6']);
      expect(result.diagnostics[0]!.severity).toBe('warning');
      expect(result.ok).toBe(true);
    });

    it('V7: a stale hash (warning)', () => {
      const view = mutated((v) => {
        v.netHash = 'fnv1a64:0000000000000000';
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V7']);
      expect(result.diagnostics[0]!.severity).toBe('warning');
      expect(result.ok).toBe(true);
    });

    it('V7: becomes stale when the net gains an element', () => {
      const changed = smallNet();
      changed.places.push({ id: 'extra', name: 'Extra', position: { x: 0, y: 0 } });
      const result = validateDomainView(changed, smallView());
      expect(rules(result.diagnostics)).toEqual(['V3', 'V7']);
    });

    it('V8: a hidden place that holds cases (warning)', () => {
      const view = mutated((v) => {
        v.places['q'] = { kind: 'hidden', reason: 'skipped' };
      });
      const result = validateDomainView(net, view);
      expect(rules(result.diagnostics)).toEqual(['V8']);
      expect(result.diagnostics[0]!.severity).toBe('warning');
      expect(result.ok).toBe(true);
    });

    describe('V9: a quantity place is a counter or hidden', () => {
      /** `done` counts an amount (a sink by its arcs) and `q` as well (a case place by its arcs). */
      const quantities = (): ReturnType<typeof smallNet> => {
        const amounts = smallNet();
        amounts.places.find((p) => p.id === 'done')!.role = 'quantity';
        amounts.places.find((p) => p.id === 'q')!.role = 'quantity';
        return amounts;
      };
      const viewFor = (
        amounts: ReturnType<typeof smallNet>,
        change: (v: DomainView) => void,
      ): DomainView =>
        mutated((v) => {
          v.netHash = netHash(amounts);
          change(v);
        });
      const belt = [
        [100, 300],
        [300, 300],
      ] as [number, number][];

      it('V9: a quantity place drawn as a queue, conveyor or buffer (error)', () => {
        const amounts = quantities();
        for (const kind of ['queue', 'conveyor', 'buffer'] as const) {
          const view = viewFor(amounts, (v) => {
            v.places['q'] = { kind, path: belt };
          });
          const result = validateDomainView(amounts, view);
          expect(rules(result.diagnostics), kind).toEqual(['V9']);
          expect(result.diagnostics[0]).toMatchObject({
            severity: 'error',
            path: 'places.q.kind',
            elementId: 'q',
          });
          expect(result.diagnostics[0]!.message).toMatch(/counts an amount/);
          expect(result.ok).toBe(false);
        }
      });

      it('V9: a quantity place drawn as slots (error)', () => {
        const amounts = quantities();
        const view = viewFor(amounts, (v) => {
          v.places['done'] = { kind: 'slots', of: 'work' };
        });
        expect(rules(validateDomainView(amounts, view).diagnostics)).toEqual(['V9']);
      });

      it('is satisfied by a pool, a source, a sink or a hidden entry', () => {
        const amounts = quantities();
        const kinds: Array<(v: DomainView) => void> = [
          (v) => {
            v.places['q'] = { kind: 'pool', pos: [150, 150] };
          },
          (v) => {
            v.places['q'] = { kind: 'source', box: [50, 50, 80, 40] };
          },
          (v) => {
            v.places['q'] = { kind: 'sink', box: [50, 50, 80, 40] };
          },
          (v) => {
            v.places['q'] = { kind: 'hidden', reason: 'auxiliary place' };
          },
        ];
        for (const change of kinds) {
          const result = validateDomainView(amounts, viewFor(amounts, change));
          expect(result.diagnostics).toEqual([]);
        }
      });

      it('a hidden quantity place is not reported by V8, which is about cases', () => {
        const amounts = quantities();
        const view = viewFor(amounts, (v) => {
          v.places['q'] = { kind: 'hidden', reason: 'auxiliary place' };
        });
        expect(validateDomainView(amounts, view).diagnostics).toEqual([]);
      });

      it('the rule V4 does not report the same place a second time', () => {
        const amounts = quantities();
        // `q` stays a conveyor, which is wrong for a quantity as well.
        const view = viewFor(amounts, (v) => {
          v.places['done'] = { kind: 'queue', path: belt };
        });
        const found = validateDomainView(amounts, view).diagnostics;
        expect(found.map((d) => d.rule)).toEqual(['V9', 'V9']);
        expect(found.map((d) => d.elementId).sort()).toEqual(['done', 'q']);
      });
    });
  });
});

describe('netHash', () => {
  it('has the documented format', () => {
    expect(netHash(smallNet())).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
  });

  it('ignores names, positions, markings and the order of elements', () => {
    const a = smallNet();
    const b = smallNet();
    b.name = 'Other';
    b.places[0]!.name = 'Renamed';
    b.places[0]!.position = { x: 5, y: 5 };
    b.transitions[1]!.position = { x: 1, y: 1 };
    b.marking = { res: [1, 1, 1], q: [1] };
    b.places.reverse();
    b.arcs.reverse();
    expect(netHash(b)).toBe(netHash(a));
  });

  it('changes with ids and arcs', () => {
    const a = smallNet();
    const b = smallNet();
    b.arcs.pop();
    const c = smallNet();
    c.places[2]!.id = 'finished';
    expect(netHash(b)).not.toBe(netHash(a));
    expect(netHash(c)).not.toBe(netHash(a));
  });
});

describe('schema', () => {
  it('exports a JSON Schema that forbids additional properties', () => {
    const schema = domainViewJsonSchema();
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['additionalProperties']).toBe(false);
    expect(JSON.stringify(schema)).toContain('"hidden"');
  });

  it('normalizes the key order of a view', () => {
    const view = smallView();
    const { provenance, places, ...rest } = view;
    const shuffled = JSON.parse(JSON.stringify({ provenance, places, ...rest })) as DomainView;
    expect(Object.keys(normalizeDomainView(shuffled))[0]).toBe('schemaVersion');
  });
});
