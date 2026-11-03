import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  applyChoices,
  buildScene,
  choiceDeviations,
  choiceProblems,
  counterPlaces,
  defaultChoices,
  displayOfChoice,
  flowOrder,
  genericDomainView,
  stagePlaces,
  validateDomainView,
  viewChoicesSchema,
  type DomainView,
  type ViewChoices,
} from '../src';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

const bike = example('bike-frames');
const bikeView = bike.domainView as DomainView;
const AT = '2026-11-03T10:00:00.000Z';

describe('the order of the flow', () => {
  it('lists the places from the arrivals along the arcs', () => {
    const order = flowOrder(bike);
    expect(order).toHaveLength(bike.places.length);
    expect(new Set(order).size).toBe(order.length);
    expect(order.indexOf('p_orders')).toBeLessThan(order.indexOf('p_cut'));
    expect(order.indexOf('p_cut')).toBeLessThan(order.indexOf('p_welded'));
    expect(order.indexOf('p_welded')).toBeLessThan(order.indexOf('p_coated'));
    expect(order.indexOf('p_coated')).toBeLessThan(order.indexOf('p_ready'));
    expect(order.indexOf('p_ready')).toBeLessThan(order.indexOf('p_shipped'));
  });

  it('puts the stages (places with cases) and the counters (amounts, sinks) apart', () => {
    const stages = stagePlaces(bike);
    expect(stages.slice(0, 3)).toEqual(['p_orders', 'p_cut', 'p_welded']);
    expect(stages).not.toContain('p_saw');
    expect(stages).not.toContain('p_tubes');
    expect(stages).not.toContain('p_shipped');
    const counters = counterPlaces(bike);
    expect(counters).toEqual(
      expect.arrayContaining(['p_tubes', 'p_scrap', 'p_waste', 'p_co2', 'p_shipped']),
    );
    expect(counters).not.toContain('p_welded');
  });

  it('visits every place of a net with a cycle once', () => {
    const ring = example('token-ring');
    expect(new Set(flowOrder(ring)).size).toBe(ring.places.length);
  });
});

describe('the choices to start from', () => {
  it('are made from the view of the net, if it has one', () => {
    const choices = defaultChoices(bike, bikeView);
    expect(choices.setting).toBe(bikeView.meta.theme);
    expect(choices.viewName).toBe(bikeView.meta.viewName);
    expect(choices.entity).toMatchObject({ singular: bikeView.meta.entity.singular });
    expect(choices.stages['p_welded']).toEqual({ sprite: 'frame', tint: 'neutral' });
    expect(choices.stages['p_orders']).toEqual({ sprite: 'document' });
    expect(choices.counters['p_tubes']).toMatchObject({
      style: 'fill',
      max: 200,
      icon: 'material',
    });
    expect(choices.counters['p_co2']).toMatchObject({
      style: 'pictogram',
      per: 50,
      icon: 'co2',
      history: true,
    });
    expect(choices.layout).toBe('editor');
    expect(choices.equipment).toBe('plain');
    expect(choiceProblems(bike, choices)).toEqual([]);
  });

  it('are made from the generic view otherwise: the stages in flow order, all like the entity', () => {
    const choices = defaultChoices(bike, null);
    expect(Object.keys(choices.stages)).toEqual(stagePlaces(bike));
    expect(Object.values(choices.stages).every((look) => look === null)).toBe(true);
    expect(Object.keys(choices.counters)).toEqual(counterPlaces(bike));
    expect(choices.viewName).toBe('');
    expect(choices.setting).toBe(bike.name);
    expect(Object.values(choices.counters).every((c) => c.style === 'number')).toBe(true);
  });

  it('take the limit of a container from the capacity, else from the analysis, else from the marking', () => {
    const net = structuredClone(bike);
    net.places.find((p) => p.id === 'p_scrap')!.capacity = 40;
    expect(defaultChoices(net, null).counters['p_scrap']!.max).toBe(40);
    expect(defaultChoices(net, null, { p_scrap: 25 }).counters['p_scrap']!.max).toBe(40);
    expect(defaultChoices(net, null, { p_waste: 25 }).counters['p_waste']!.max).toBe(25);
    // The stock starts with some tokens: a round number above twice that.
    const stock = net.marking['p_tubes']?.length ?? 0;
    const max = defaultChoices(net, null).counters['p_tubes']!.max;
    expect(max).toBeGreaterThanOrEqual(2 * stock);
    expect(max).toBeLessThan(10 * Math.max(10, 2 * stock));
  });

  it('size a pictogram for ten to twenty symbols at the expected amount', () => {
    for (const expected of [10, 100, 1000, 7300]) {
      const choices = defaultChoices(bike, null, { p_shipped: expected });
      const symbols = expected / choices.counters['p_shipped']!.per;
      expect(symbols).toBeGreaterThanOrEqual(7);
      expect(symbols).toBeLessThanOrEqual(30);
    }
    expect(defaultChoices(bike, null).counters['p_shipped']!.per).toBeGreaterThanOrEqual(1);
  });

  it('survive a round trip through JSON', () => {
    const choices = defaultChoices(bike, bikeView);
    const read = viewChoicesSchema.parse(JSON.parse(JSON.stringify(choices)));
    expect(read).toEqual(choices);
    expect(viewChoicesSchema.safeParse({ ...choices, layout: 'diagonal' }).success).toBe(false);
  });
});

describe('checking the choices (V10 to V12)', () => {
  const base = defaultChoices(bike, bikeView);
  const paths = (choices: ViewChoices) => choiceProblems(bike, choices).map((p) => p.path);

  it('names the field of a wrong emoji', () => {
    expect(paths({ ...base, entity: { singular: 'A', plural: 'As', emoji: 'ab' } })).toEqual([
      'entity.emoji',
    ]);
    expect(paths({ ...base, stages: { ...base.stages, p_cut: { emoji: '🦄🦄' } } })).toEqual([
      'stages.p_cut.emoji',
    ]);
    const counters = {
      ...base.counters,
      p_co2: { ...base.counters['p_co2']!, emoji: 'x', icon: undefined },
    };
    delete counters['p_co2']!.icon;
    expect(paths({ ...base, counters })).toEqual(['counters.p_co2.emoji']);
    expect(
      choiceProblems(bike, { ...base, entity: { singular: 'A', plural: 'As', emoji: '1' } })[0]!
        .rule,
    ).toBe('V12');
  });

  it('accepts good emoji', () => {
    expect(
      paths({
        ...base,
        entity: { singular: 'A', plural: 'As', emoji: '🦄' },
        stages: { ...base.stages, p_cut: { emoji: '👩‍⚕️' } },
      }),
    ).toEqual([]);
  });

  it('knows which symbols fit a counter, as rule V10 does', () => {
    const wrong = {
      ...base,
      counters: {
        ...base.counters,
        p_co2: { ...base.counters['p_co2']!, icon: 'parcel' as const },
      },
    };
    const problem = choiceProblems(bike, wrong)[0]!;
    expect(problem).toMatchObject({ path: 'counters.p_co2.icon', rule: 'V10' });
    const both = {
      ...base,
      counters: { ...base.counters, p_co2: { ...base.counters['p_co2']!, emoji: '🌳' } },
    };
    expect(choiceProblems(bike, both)[0]).toMatchObject({ rule: 'V12' });
  });

  it('asks for a positive limit and a positive number per symbol', () => {
    const counters = {
      ...base.counters,
      p_tubes: { ...base.counters['p_tubes']!, max: 0 },
      p_co2: { ...base.counters['p_co2']!, per: -1 },
    };
    expect(paths({ ...base, counters }).sort()).toEqual([
      'counters.p_co2.per',
      'counters.p_tubes.max',
    ]);
  });

  it('does not allow an appearance on a place that holds no cases', () => {
    expect(paths({ ...base, stages: { ...base.stages, p_saw: { sprite: 'dot' } } })).toEqual([
      'stages.p_saw',
    ]);
  });
});

describe('applying the choices', () => {
  const choices = (): ViewChoices => {
    const c = defaultChoices(bike, bikeView);
    c.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
    c.stages['p_welded'] = { emoji: '🔥' };
    c.stages['p_cut'] = null;
    c.counters['p_co2'] = { ...c.counters['p_co2']!, emoji: '🌳' };
    delete c.counters['p_co2']!.icon;
    c.counters['p_tubes'] = { ...c.counters['p_tubes']!, style: 'pictogram', per: 20 };
    return c;
  };

  it('sets entity, looks and displays, and leaves the geometry as it is', () => {
    const { view, changed } = applyChoices(bike, bikeView, choices(), { at: AT });
    expect(view.meta.entity).toEqual({ singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' });
    expect(view.meta.canvas).toEqual(bikeView.meta.canvas);
    expect((view.places['p_welded'] as { appearance?: unknown }).appearance).toEqual({
      emoji: '🔥',
    });
    expect(view.places['p_cut']).not.toHaveProperty('appearance');
    expect(view.places['p_co2']).toMatchObject({
      display: { style: 'pictogram', emoji: '🌳', history: true },
    });
    expect(view.places['p_co2']).not.toHaveProperty('display.icon');
    // The size of the container stays, the style changed.
    expect(view.places['p_tubes']).toMatchObject({
      display: { style: 'pictogram', per: 20, icon: 'material' },
    });
    expect(changed.sort()).toEqual([
      'places.p_co2',
      'places.p_cut',
      'places.p_tubes',
      'places.p_welded',
    ]);
    // Everything else is the same object content.
    for (const key of Object.keys(bikeView.places)) {
      if (changed.includes(`places.${key}`)) continue;
      expect(view.places[key]).toEqual(bikeView.places[key]);
    }
    expect(view.transitions).toEqual(bikeView.transitions);
    expect(view.decor).toEqual(bikeView.decor);
    expect(view.arcs).toEqual(bikeView.arcs);
    expect(validateDomainView(bike, view).ok).toBe(true);
  });

  it('marks what changed as the work of the user, or leaves the provenance as it was', () => {
    const user = applyChoices(bike, bikeView, choices(), { at: AT });
    expect(user.view.provenance['places.p_welded']).toEqual({ source: 'user', at: AT });
    expect(user.view.provenance['places.p_saw']).toEqual(bikeView.provenance['places.p_saw']);
    const keep = applyChoices(bike, bikeView, choices(), { at: AT, provenance: 'keep' });
    expect(keep.view.provenance).toEqual(bikeView.provenance);
  });

  it('changes nothing when the choices are those of the view', () => {
    const result = applyChoices(bike, bikeView, defaultChoices(bike, bikeView), { at: AT });
    expect(result.changed).toEqual([]);
    expect(result.view.places).toEqual(bikeView.places);
    expect(result.view.meta).toEqual(bikeView.meta);
    // The scene is the same, too.
    expect(buildScene(bike, result.view, bike.marking)).toEqual(
      buildScene(bike, bikeView, bike.marking),
    );
  });

  it('is applied twice with the same result', () => {
    const once = applyChoices(bike, bikeView, choices(), { at: AT }).view;
    const twice = applyChoices(bike, once, choices(), { at: AT });
    expect(twice.changed).toEqual([]);
    expect(twice.view).toEqual(once);
  });

  it('skips places that cannot carry the look or the display', () => {
    const view = structuredClone(bikeView);
    view.places['p_welded'] = { kind: 'hidden', reason: 'x' };
    view.places['p_co2'] = { kind: 'hidden', reason: 'x' };
    const result = applyChoices(bike, view, choices(), { at: AT });
    expect(result.view.places['p_welded']).toEqual({ kind: 'hidden', reason: 'x' });
    expect(result.view.places['p_co2']).toEqual({ kind: 'hidden', reason: 'x' });
    expect(result.changed).not.toContain('places.p_welded');
  });

  it('works on the generic view of a net without a view, too', () => {
    const net = example('order-processing');
    const generic = genericDomainView(net, { at: AT });
    const wanted = defaultChoices(net, null);
    wanted.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
    const stage = stagePlaces(net)[0]!;
    wanted.stages[stage] = { sprite: 'person', tint: 'ok' };
    const result = applyChoices(net, generic, wanted, { at: AT });
    expect(validateDomainView(net, result.view).ok).toBe(true);
    expect(result.view.meta.entity).toMatchObject({ emoji: '🦄' });
    expect(result.view.provenance[`places.${stage}`]?.source).toBe('user');
    expect(result.view.places[stage]).toMatchObject({
      appearance: { sprite: 'person', tint: 'ok' },
    });
  });

  it('builds the display of a choice, with unit and size from the old one', () => {
    const choice = defaultChoices(bike, bikeView).counters['p_tubes']!;
    const previous = {
      style: 'fill' as const,
      max: 5,
      unit: 'kg',
      size: [60, 90] as [number, number],
      low: 1,
    };
    expect(displayOfChoice({ ...choice, style: 'pictogram', per: 10 }, previous)).toEqual({
      style: 'pictogram',
      per: 10,
      size: [60, 90],
      icon: 'material',
      unit: 'kg',
    });
    expect(
      displayOfChoice({ ...choice, style: 'number', icon: undefined, history: false }, undefined),
    ).toBeUndefined();
    expect(displayOfChoice({ ...choice, style: 'fill', max: 7 }, previous)).toMatchObject({
      max: 7,
      low: 1,
    });
    expect(displayOfChoice({ ...choice, style: 'fill', max: 0.5 }, previous)).not.toHaveProperty(
      'low',
    );
  });
});

describe('what a model did differently', () => {
  it('says nothing for a view that already has the choices', () => {
    expect(choiceDeviations(bike, bikeView, defaultChoices(bike, bikeView))).toEqual([]);
  });

  it('names every deviation, with what the model wrote', () => {
    const c = defaultChoices(bike, bikeView);
    c.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
    c.stages['p_welded'] = { emoji: '🔥' };
    c.counters['p_shipped'] = { ...c.counters['p_shipped']!, style: 'fill', max: 30 };
    const notes = choiceDeviations(bike, bikeView, c);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.startsWith('Choice applied:'))).toBe(true);
    expect(notes[0]).toContain('🦄');
    expect(notes[1]).toContain('Geschweißt');
    expect(notes[1]).toContain('🔥');
    expect(notes[1]).toContain('frame (neutral)');
    expect(notes[2]).toContain('Ausgeliefert');
    expect(notes[2]).toContain('fill');
  });

  it('does not count a number display as a deviation from no display', () => {
    const view = structuredClone(bikeView);
    view.places['p_waste'] = { kind: 'sink', box: [10, 10, 80, 60], display: { style: 'number' } };
    const c = defaultChoices(bike, bikeView);
    c.counters['p_waste'] = {
      ...c.counters['p_waste']!,
      style: 'number',
      icon: undefined,
      history: false,
    };
    delete c.counters['p_waste']!.icon;
    expect(choiceDeviations(bike, view, c)).toEqual([]);
  });
});
