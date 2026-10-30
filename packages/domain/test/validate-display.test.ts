import { describe, expect, it } from 'vitest';
import {
  DISPLAY_ICONS,
  QUANTITY_ICONS,
  SPRITES,
  TINTS,
  TINT_TONES,
  allowedIcons,
  domainViewJsonSchema,
  iconAllowed,
  isItemIcon,
  isQuantityIcon,
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

function mutated(change: (view: DomainView) => void, net = smallNet()): DomainView {
  const view = structuredClone(smallView(net));
  view.netHash = netHash(net);
  change(view);
  return view;
}

/** `done` counts an amount (a sink by its arcs), `q` is a place for cases, `res` a resource. */
function amountNet(): ReturnType<typeof smallNet> {
  const net = smallNet();
  net.places.find((p) => p.id === 'done')!.role = 'quantity';
  return net;
}

const belt: Array<[number, number]> = [
  [100, 300],
  [300, 300],
];

describe('the new fields of the schema (N2)', () => {
  it('knows the new sprites, the tints and the symbols of amounts', () => {
    expect(SPRITES).toEqual([
      'parcel',
      'person',
      'vehicle',
      'document',
      'dot',
      'frame',
      'bicycle',
      'bars',
    ]);
    expect(TINTS).toEqual(['accent', 'ok', 'warn', 'danger', 'info', 'neutral']);
    expect(QUANTITY_ICONS).toEqual(['co2', 'material', 'scrap', 'waste', 'energy', 'water', 'dot']);
    // Every symbol once, and each one is of one kind (the dot is both).
    expect(new Set(DISPLAY_ICONS).size).toBe(DISPLAY_ICONS.length);
    expect(DISPLAY_ICONS.every((icon) => isQuantityIcon(icon) || isItemIcon(icon))).toBe(true);
    // A tint is a token of the palette and never a color of its own.
    for (const tint of TINTS) expect(TINT_TONES[tint]).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('accepts a fill, a pictogram and a plain number, and keeps their key order', () => {
    const view = mutated((v) => {
      v.places['done'] = {
        kind: 'sink',
        box: [600, 180, 80, 40],
        display: { style: 'pictogram', per: 5, icon: 'parcel', history: true },
      };
      v.places['q'] = {
        kind: 'conveyor',
        path: belt,
        appearance: { sprite: 'frame', tint: 'accent' },
      };
    });
    const result = validateDomainView(smallNet(), view);
    expect(result.diagnostics.filter((d) => d.rule === 'V1')).toEqual([]);
    const pool = {
      kind: 'pool',
      pos: [150, 150],
      display: { icon: 'material', low: 40, max: 200, style: 'fill' },
    };
    const shuffled = JSON.parse(JSON.stringify({ ...view, places: { ...view.places, q: pool } }));
    const normalized = normalizeDomainView(shuffled as DomainView);
    const display = (normalized.places['q'] as { display: object }).display;
    expect(Object.keys(display)).toEqual(['style', 'max', 'low', 'icon']);
    for (const display of [
      { style: 'number' },
      { style: 'number', history: true },
      { style: 'fill', max: 200, size: [60, 90], unit: 'kg' },
      { style: 'pictogram', per: 1, icon: 'waste' },
    ]) {
      const one = mutated((v) => {
        v.places['q'] = { kind: 'pool', pos: [150, 150], display } as never;
      });
      expect(
        validateDomainView(smallNet(), one).diagnostics.filter((d) => d.rule === 'V1'),
      ).toEqual([]);
    }
  });

  it('rejects what is wrong inside a display or an appearance, at the field', () => {
    const wrong: Array<[unknown, string]> = [
      [{ style: 'fill' }, 'places.q.display.max'],
      [{ style: 'fill', max: 0 }, 'places.q.display.max'],
      [{ style: 'fill', max: -5 }, 'places.q.display.max'],
      [{ style: 'fill', max: 10, low: -1 }, 'places.q.display.low'],
      [{ style: 'pictogram' }, 'places.q.display.per'],
      [{ style: 'pictogram', per: 0 }, 'places.q.display.per'],
      [{ style: 'pictogram', per: 5, icon: 'banana' }, 'places.q.display.icon'],
      [{ style: 'pictogram', per: 5, color: 'red' }, 'places.q.display.color'],
      [{ style: 'fill', max: 10, size: [0, 40] }, 'places.q.display.size[0]'],
      [{ style: 'gauge', max: 10 }, 'places.q.display'],
    ];
    for (const [display, path] of wrong) {
      const view = mutated((v) => {
        v.places['q'] = { kind: 'pool', pos: [150, 150], display } as never;
      });
      const result = validateDomainView(smallNet(), view);
      expect(result.ok, JSON.stringify(display)).toBe(false);
      const found = result.diagnostics.find((d) => d.path.startsWith(path));
      expect(found, `${JSON.stringify(display)} at ${path}`).toBeDefined();
      expect(found!.rule).toBe('V10');
      expect(found!.elementId).toBe('q');
    }
    const appearances: Array<[unknown, string]> = [
      [{ sprite: 'unicorn' }, 'places.q.appearance.sprite'],
      [{ sprite: 'frame', tint: '#ff0000' }, 'places.q.appearance.tint'],
      [{ sprite: 'frame', tint: 'red' }, 'places.q.appearance.tint'],
      [{ tint: 'accent' }, 'places.q.appearance.sprite'],
      [{ sprite: 'frame', glow: true }, 'places.q.appearance.glow'],
    ];
    for (const [appearance, path] of appearances) {
      const view = mutated((v) => {
        v.places['q'] = { kind: 'conveyor', path: belt, appearance } as never;
      });
      const result = validateDomainView(smallNet(), view);
      expect(result.ok, JSON.stringify(appearance)).toBe(false);
      const found = result.diagnostics.find((d) => d.path.startsWith(path));
      expect(found, `${JSON.stringify(appearance)} at ${path}`).toBeDefined();
      expect(found!.rule).toBe('V11');
    }
  });

  it('tells a language model the new fields in its JSON Schema', () => {
    const text = JSON.stringify(domainViewJsonSchema());
    for (const word of [
      '"display"',
      '"appearance"',
      '"pictogram"',
      '"fill"',
      '"co2"',
      '"bicycle"',
    ]) {
      expect(text).toContain(word);
    }
  });
});

describe('A5 (N2): V10, the display of a counter', () => {
  it('V10: a display on something that is no counter (error)', () => {
    for (const entry of [
      { kind: 'conveyor', path: belt },
      { kind: 'buffer', path: belt },
      { kind: 'hidden', reason: 'not needed' },
    ]) {
      const view = mutated((v) => {
        v.places['q'] = { ...entry, display: { style: 'fill', max: 10 } } as never;
      });
      const result = validateDomainView(smallNet(), view);
      expect(rules(result.diagnostics), entry.kind).toEqual(['V10']);
      expect(result.diagnostics[0]).toMatchObject({
        severity: 'error',
        path: 'places.q.display',
        elementId: 'q',
      });
      expect(result.diagnostics[0]!.message).toContain(`"${entry.kind}"`);
      expect(result.ok).toBe(false);
    }
    const slots = mutated((v) => {
      v.places['res'] = { kind: 'slots', of: 'work', display: { style: 'number' } } as never;
    });
    expect(rules(validateDomainView(smallNet(), slots).diagnostics)).toEqual(['V10']);
  });

  it('V10: a fill without a positive max and a pictogram without a positive per (error)', () => {
    const fill = mutated((v) => {
      v.places['q'] = { kind: 'pool', pos: [150, 150], display: { style: 'fill', max: 0 } };
    });
    const found = validateDomainView(smallNet(), fill);
    expect(rules(found.diagnostics)).toEqual(['V10']);
    expect(found.diagnostics[0]!.path).toBe('places.q.display.max');
    expect(found.diagnostics[0]!.message).toMatch(/positive/);
    const pictogram = mutated((v) => {
      v.places['done'] = {
        kind: 'sink',
        box: [600, 180, 80, 40],
        display: { style: 'pictogram', per: -1 },
      };
    });
    const result = validateDomainView(smallNet(), pictogram);
    expect(rules(result.diagnostics)).toEqual(['V10']);
    expect(result.diagnostics[0]!.path).toBe('places.done.display.per');
  });

  it('V10: low above max (error)', () => {
    const view = mutated((v) => {
      v.places['q'] = {
        kind: 'pool',
        pos: [150, 150],
        display: { style: 'fill', max: 100, low: 120 },
      };
    });
    const result = validateDomainView(smallNet(), view);
    expect(rules(result.diagnostics)).toEqual(['V10']);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: 'places.q.display.low',
    });
  });

  it('V10: a symbol that does not fit the role of the place (error)', () => {
    const net = amountNet();
    const quantityWith = (icon: string) =>
      mutated((v) => {
        v.places['done'] = {
          kind: 'sink',
          box: [600, 180, 80, 40],
          display: { style: 'pictogram', per: 5, icon },
        } as never;
      }, net);
    // An amount shows pictures of amounts, not of parcels.
    const parcel = validateDomainView(net, quantityWith('parcel'));
    expect(rules(parcel.diagnostics)).toEqual(['V10']);
    expect(parcel.diagnostics[0]!.path).toBe('places.done.display.icon');
    expect(parcel.diagnostics[0]!.message).toMatch(/co2/);
    for (const icon of QUANTITY_ICONS) {
      expect(validateDomainView(net, quantityWith(icon)).diagnostics, icon).toEqual([]);
    }
    // A place for cases shows pictures of objects, and a resource shows the dot only.
    const caseWith = (icon: string, id: string) =>
      mutated((v) => {
        v.places[id] = {
          kind: 'pool',
          pos: [150, 150],
          display: { style: 'pictogram', per: 5, icon },
        } as never;
        if (id === 'res') v.transitions['work'] = smallView().transitions['work']!;
      });
    expect(rules(validateDomainView(smallNet(), caseWith('co2', 'q')).diagnostics)).toEqual([
      'V10',
    ]);
    expect(validateDomainView(smallNet(), caseWith('parcel', 'q')).diagnostics).toEqual([]);
    expect(validateDomainView(smallNet(), caseWith('dot', 'q')).diagnostics).toEqual([]);
    const resource = validateDomainView(smallNet(), caseWith('material', 'res'));
    expect(rules(resource.diagnostics)).toEqual(['V10']);
    expect(validateDomainView(smallNet(), caseWith('dot', 'res')).diagnostics).toEqual([]);
  });

  it('V10: the allowed symbols follow the role', () => {
    expect(iconAllowed('quantity', 'co2')).toBe(true);
    expect(iconAllowed('quantity', 'parcel')).toBe(false);
    expect(iconAllowed('sink', 'co2')).toBe(true);
    expect(iconAllowed('sink', 'parcel')).toBe(true);
    expect(iconAllowed('source', 'parcel')).toBe(true);
    expect(iconAllowed('source', 'co2')).toBe(false);
    expect(iconAllowed('case', 'frame')).toBe(true);
    expect(iconAllowed('resource', 'dot')).toBe(true);
    expect(iconAllowed('resource', 'frame')).toBe(false);
    expect(allowedIcons('quantity')).toEqual([...QUANTITY_ICONS]);
    expect(allowedIcons('resource')).toEqual(['dot']);
    expect(allowedIcons('sink')).toEqual([...DISPLAY_ICONS]);
  });

  it('V10: a max below the capacity of the place is a hint, not an error (warning)', () => {
    const net = smallNet();
    net.places.find((p) => p.id === 'q')!.capacity = 100;
    const withMax = (max: number) =>
      mutated((v) => {
        v.places['q'] = { kind: 'pool', pos: [150, 150], display: { style: 'fill', max } };
      }, net);
    const low = validateDomainView(net, withMax(80));
    expect(rules(low.diagnostics)).toEqual(['V10']);
    expect(low.diagnostics[0]).toMatchObject({
      severity: 'warning',
      path: 'places.q.display.max',
      elementId: 'q',
    });
    expect(low.diagnostics[0]!.message).toMatch(/capacity/);
    expect(low.ok).toBe(true);
    expect(validateDomainView(net, withMax(100)).diagnostics).toEqual([]);
    expect(validateDomainView(net, withMax(250)).diagnostics).toEqual([]);
    // Without a capacity there is nothing to compare with.
    const unbounded = mutated((v) => {
      v.places['q'] = { kind: 'pool', pos: [150, 150], display: { style: 'fill', max: 1 } };
    });
    expect(validateDomainView(smallNet(), unbounded).diagnostics).toEqual([]);
  });
});

describe('A5 (N2): V11, the appearance of cases', () => {
  it('V11: an appearance on a place that is no belt or box (error)', () => {
    for (const entry of [
      { kind: 'pool', pos: [150, 150] },
      { kind: 'hidden', reason: 'not needed' },
    ]) {
      const view = mutated((v) => {
        v.places['q'] = { ...entry, appearance: { sprite: 'frame' } } as never;
      });
      const result = validateDomainView(smallNet(), view);
      expect(rules(result.diagnostics), entry.kind).toEqual(['V11']);
      expect(result.diagnostics[0]).toMatchObject({
        severity: 'error',
        path: 'places.q.appearance',
        elementId: 'q',
      });
      expect(result.diagnostics[0]!.message).toContain(`"${entry.kind}"`);
    }
    const slots = mutated((v) => {
      v.places['res'] = { kind: 'slots', of: 'work', appearance: { sprite: 'dot' } } as never;
    });
    expect(rules(validateDomainView(smallNet(), slots).diagnostics)).toEqual(['V11']);
  });

  it('V11: an appearance on a quantity place (error)', () => {
    const net = amountNet();
    const view = mutated((v) => {
      v.places['done'] = {
        kind: 'sink',
        box: [600, 180, 80, 40],
        appearance: { sprite: 'parcel' },
      };
    }, net);
    const result = validateDomainView(net, view);
    expect(rules(result.diagnostics)).toEqual(['V11']);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: 'places.done.appearance',
      elementId: 'done',
    });
    expect(result.diagnostics[0]!.message).toMatch(/quantity/);
    expect(result.ok).toBe(false);
  });

  it('is satisfied by the places that hold cases', () => {
    const view = mutated((v) => {
      v.places['q'] = {
        kind: 'conveyor',
        path: belt,
        appearance: { sprite: 'bars', tint: 'neutral' },
      };
      v.places['done'] = {
        kind: 'sink',
        box: [600, 180, 80, 40],
        appearance: { sprite: 'bicycle' },
        display: { style: 'pictogram', per: 5, icon: 'bicycle' },
      };
    });
    expect(validateDomainView(smallNet(), view).diagnostics).toEqual([]);
    for (const kind of ['queue', 'buffer'] as const) {
      const other = mutated((v) => {
        v.places['q'] = { kind, path: belt, appearance: { sprite: 'document' } };
      });
      expect(validateDomainView(smallNet(), other).diagnostics, kind).toEqual([]);
    }
  });

  it('the findings of a language model are told apart: V10 for a display, V11 for an appearance', () => {
    const view = mutated((v) => {
      v.places['q'] = {
        kind: 'pool',
        pos: [150, 150],
        display: { style: 'fill', max: 0 },
        appearance: { sprite: 'frame' },
      } as never;
    });
    const found = validateDomainView(smallNet(), view).diagnostics;
    expect(found.map((d) => `${d.rule} ${d.path}`).sort()).toEqual([
      'V10 places.q.display.max',
      'V11 places.q.appearance',
    ]);
  });
});
