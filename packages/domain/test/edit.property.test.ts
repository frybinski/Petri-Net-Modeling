import { createEmptyNet, type PetriNet } from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addSlot,
  domainViewSchema,
  genericDomainView,
  GRID,
  handlesFor,
  hideEntry,
  insertPoint,
  kindChoices,
  moveEntry,
  movePoint,
  moveSlot,
  ref,
  removePoint,
  removeSlot,
  resizeEntry,
  setBox,
  setEntryKind,
  setLabel,
  validateDomainView,
  type DomainView,
  type EntryRef,
  type HandleKind,
} from '../src';

const spec = fc.record({
  places: fc.integer({ min: 1, max: 9 }),
  transitions: fc.integer({ min: 1, max: 8 }),
  arcs: fc.array(fc.tuple(fc.nat(40), fc.nat(40), fc.boolean()), { maxLength: 40 }),
  marks: fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 9 }),
});

function build(s: typeof spec extends fc.Arbitrary<infer T> ? T : never): PetriNet {
  const net = createEmptyNet('Random');
  for (let i = 0; i < s.places; i += 1) {
    net.places.push({
      id: `p${i}`,
      name: `P${i}`,
      position: { x: (i % 4) * 160, y: Math.floor(i / 4) * 140 },
    });
    const marks = s.marks[i] ?? 0;
    if (marks > 0) net.marking[`p${i}`] = Array.from({ length: marks }, () => 1);
  }
  for (let j = 0; j < s.transitions; j += 1) {
    net.transitions.push({
      id: `t${j}`,
      name: `T${j}`,
      position: { x: (j % 4) * 160 + 80, y: Math.floor(j / 4) * 140 + 60 },
    });
  }
  const seen = new Set<string>();
  s.arcs.forEach(([a, b, toPlace], index) => {
    const p = `p${a % s.places}`;
    const t = `t${b % s.transitions}`;
    const [source, target] = toPlace ? [t, p] : [p, t];
    if (seen.has(`${source}>${target}`)) return;
    seen.add(`${source}>${target}`);
    net.arcs.push({ id: `a${index}`, source, target, weight: 1 });
  });
  return net;
}

const HANDLES: HandleKind[] = [
  'resize-nw',
  'resize-ne',
  'resize-sw',
  'resize-se',
  'resize-n',
  'resize-s',
  'resize-e',
  'resize-w',
];

const delta = fc.tuple(fc.integer({ min: -400, max: 400 }), fc.integer({ min: -400, max: 400 }));
const op = fc.record({
  kind: fc.constantFrom(
    'move',
    'resize',
    'point',
    'insert',
    'remove',
    'slot',
    'addSlot',
    'removeSlot',
    'kind',
    'label',
    'hide',
    'box',
  ),
  entry: fc.nat(1000),
  index: fc.nat(30),
  handle: fc.constantFrom(...HANDLES),
  delta,
  snap: fc.constantFrom(0, GRID),
  keepAspect: fc.boolean(),
  choice: fc.nat(10),
});
type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

function entries(view: DomainView): EntryRef[] {
  return [
    ...Object.keys(view.places).map((id) => ref('places', id)),
    ...Object.keys(view.transitions).map((id) => ref('transitions', id)),
    ...Object.keys(view.arcs ?? {}).map((key) => ref('arcs', key)),
    ...(view.decor ?? []).map((_, i) => ref('decor', i)),
  ];
}

/** The entries an operation makes sense for, so that most steps change something. */
function candidates(view: DomainView, kind: Op['kind']): EntryRef[] {
  const all = entries(view);
  const needs = (test: (kinds: string[]) => boolean): EntryRef[] =>
    all.filter((e) => test(handlesFor(view, e).map((h) => h.kind)));
  switch (kind) {
    case 'resize':
    case 'box':
      return needs((k) => k.includes('resize-se'));
    case 'point':
    case 'insert':
    case 'remove':
      return needs((k) => k.includes('point') && k.includes('segment'));
    case 'slot':
    case 'removeSlot':
      return needs((k) => k.includes('slot'));
    case 'addSlot':
      return needs((k) => k.includes('resize-se') || k.includes('slot')).filter(
        (e) => e.section === 'transitions',
      );
    default:
      return all;
  }
}

function pick(view: DomainView, o: Op): EntryRef | undefined {
  const all = candidates(view, o.kind);
  return all[o.entry % Math.max(1, all.length)];
}

function apply(net: PetriNet, view: DomainView, o: Op, withNet: boolean): DomainView {
  const target = pick(view, o);
  if (!target) return view;
  const at = '2026-03-03T00:00:00.000Z';
  const options = { at, snap: o.snap, keepAspect: o.keepAspect, ...(withNet && { net }) };
  const handles = handlesFor(view, target);
  const points = handles.filter((h) => h.kind === 'point');
  const slots = handles.filter((h) => h.kind === 'slot');
  switch (o.kind) {
    case 'move':
      return moveEntry(view, target, o.delta, options);
    case 'resize':
      return resizeEntry(view, target, o.handle, o.delta, options);
    case 'point': {
      const p = points[o.index % Math.max(1, points.length)];
      return p
        ? movePoint(
            view,
            target,
            p.index ?? 0,
            [p.at[0] + o.delta[0], p.at[1] + o.delta[1]],
            options,
          )
        : view;
    }
    case 'insert':
      return insertPoint(view, target, o.index % 5, undefined, options);
    case 'remove':
      return removePoint(view, target, o.index % 6, options);
    case 'slot': {
      const s = slots[o.index % Math.max(1, slots.length)];
      return s
        ? moveSlot(
            view,
            target,
            s.index ?? 0,
            [s.at[0] + o.delta[0], s.at[1] + o.delta[1]],
            options,
          )
        : view;
    }
    case 'addSlot':
      return addSlot(view, target, undefined, options);
    case 'removeSlot':
      return removeSlot(view, target, o.index % 4, options);
    case 'kind': {
      const choices = kindChoices(net, target);
      const kind = choices[o.choice % Math.max(1, choices.length)];
      return kind ? setEntryKind(view, net, target, kind, options) : view;
    }
    case 'label':
      return setLabel(view, target, `L${o.index}`, options);
    case 'hide':
      return hideEntry(view, net, target, 'test', options);
    case 'box':
      return setBox(
        view,
        target,
        [o.delta[0] + 300, o.delta[1] + 300, o.index * 5, o.index * 4],
        options,
      );
  }
}

/** Keys of the entries that differ between two views. */
function differing(a: DomainView, b: DomainView): Set<string> {
  const out = new Set<string>();
  const compare = (key: string, x: unknown, y: unknown): void => {
    if (JSON.stringify(x) !== JSON.stringify(y)) out.add(key);
  };
  for (const id of new Set([...Object.keys(a.places), ...Object.keys(b.places)])) {
    compare(`places.${id}`, a.places[id], b.places[id]);
  }
  for (const id of new Set([...Object.keys(a.transitions), ...Object.keys(b.transitions)])) {
    compare(`transitions.${id}`, a.transitions[id], b.transitions[id]);
  }
  for (const key of new Set([...Object.keys(a.arcs ?? {}), ...Object.keys(b.arcs ?? {})])) {
    compare(`arcs.${key}`, a.arcs?.[key], b.arcs?.[key]);
  }
  const n = Math.max(a.decor?.length ?? 0, b.decor?.length ?? 0);
  for (let i = 0; i < n; i += 1) compare(`decor.${i}`, a.decor?.[i], b.decor?.[i]);
  return out;
}

function errorPaths(net: PetriNet, view: DomainView, rules: string[]): string[] {
  return validateDomainView(net, view)
    .diagnostics.filter((d) => d.severity === 'error' && rules.includes(d.rule))
    .map((d) => `${d.rule}:${d.path}`);
}

describe('editing a view', () => {
  it('keeps the view valid and changes only the addressed entry', () => {
    let steps = 0;
    let effective = 0;
    fc.assert(
      fc.property(
        spec,
        fc.array(op, { minLength: 1, maxLength: 12 }),
        fc.boolean(),
        (s, ops, withNet) => {
          const net = build(s);
          let view = genericDomainView(net, { at: '2026-01-01T00:00:00.000Z' });
          // The generic view has decor, give the run a few more things to edit.
          view = {
            ...view,
            decor: [...(view.decor ?? []), { kind: 'room', rect: [100, 100, 200, 120] }],
          };
          expect(errorPaths(net, view, ['V1', 'V2', 'V3', 'V4', 'V5'])).toEqual([]);
          for (const o of ops) {
            const before = view;
            const next = apply(net, before, o, withNet);
            steps += 1;
            // V1: the result still has the shape of the schema.
            expect(domainViewSchema.safeParse(next).success).toBe(true);
            // V4 and V5 stay valid.
            expect(errorPaths(net, next, ['V1', 'V4', 'V5'])).toEqual([]);
            // Only one entry changes, apart from arcs that move along or lose their path.
            if (o.kind !== 'hide') {
              const others = [...differing(before, next)].filter((key) => !key.startsWith('arcs.'));
              expect(others.length).toBeLessThanOrEqual(1);
            }
            if (next !== before) effective += 1;
            view = next;
          }
          return true;
        },
      ),
      { numRuns: 150 },
    );
    expect(steps).toBeGreaterThan(500);
    // Most steps really changed something (the property is not met by doing nothing).
    expect(effective).toBeGreaterThan(steps / 3);
  }, 60_000);

  it('changes exactly the addressed entry (and its provenance) when no net is given', () => {
    fc.assert(
      fc.property(spec, op, (s, o) => {
        const net = build(s);
        const view = genericDomainView(net, { at: '2026-01-01T00:00:00.000Z' });
        const target = pick(view, o);
        if (!target) return true;
        const next = apply(net, view, o, false);
        const touched = [...differing(view, next)];
        const expected = `${target.section}.${target.key}`;
        // A hidden element also loses the arcs next to it, as documented.
        const allowed = (key: string): boolean =>
          key === expected || (o.kind === 'hide' && key.startsWith('arcs.'));
        expect(touched.filter((key) => !allowed(key))).toEqual([]);
        const provenance = new Set<string>();
        for (const key of new Set([
          ...Object.keys(view.provenance),
          ...Object.keys(next.provenance),
        ])) {
          if (JSON.stringify(view.provenance[key]) !== JSON.stringify(next.provenance[key])) {
            provenance.add(key);
          }
        }
        for (const key of provenance) {
          expect(key === expected || (o.kind === 'hide' && key.startsWith('arcs.'))).toBe(true);
          if (key === expected) expect(next.provenance[key]?.source).toBe('user');
        }
        return true;
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});
