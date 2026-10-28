import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { convertLegacyMap, validateDomainView, type LegacyMap } from '../src';

const root = join(import.meta.dirname, '..', '..', '..');
const load = (example: string, fixture: string) => ({
  net: parseNetText(readFileSync(join(root, 'examples', `${example}.pn.json`), 'utf8')),
  legacy: JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', `legacy-${fixture}-map.json`), 'utf8'),
  ) as LegacyMap,
});
const AT = '2026-10-28T00:00:00.000Z';
const canvas = { width: 1000, height: 560 };

describe('convertLegacyMap', () => {
  it('converts the parcel center mapping of the mockup', () => {
    const { net, legacy } = load('parcel-center', 'paket');
    const view = convertLegacyMap(net, legacy, { canvas, plural: 'Pakete', at: AT });
    expect(view.meta).toMatchObject({
      theme: 'Paketzentrum',
      viewName: 'Halle',
      entity: { singular: 'Paket', plural: 'Pakete', sprite: 'parcel' },
    });
    expect(view.places['p_in']?.kind).toBe('conveyor');
    expect(view.places['p_scanner']).toEqual({ kind: 'slots', of: 't_scan' });
    expect(view.places['p_done']?.kind).toBe('sink');
    expect(view.transitions['t_arr']?.kind).toBe('dock');
    expect(view.transitions['t_sort']?.kind).toBe('machine');
    expect(view.transitions['t_rA']).toMatchObject({ kind: 'waypoint', pass: true });
    expect(view.transitions['t_loadA']?.kind).toBe('gate');
    expect(view.arcs?.['t_loadA>p_done']?.path.length).toBeGreaterThanOrEqual(3);
    const result = validateDomainView(net, view);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // The old geometry had belts too short for ten tokens; the example files were adjusted.
    expect(new Set(result.diagnostics.map((d) => d.rule))).toEqual(new Set(['V6']));
  });

  it('converts the smart office mapping of the mockup', () => {
    const { net, legacy } = load('smart-office', 'office');
    const view = convertLegacyMap(net, legacy, { canvas, plural: 'Personen', at: AT });
    expect(view.meta.entity.sprite).toBe('person');
    expect(view.transitions['o_work']).toMatchObject({ kind: 'area' });
    expect(view.transitions['o_meet']).toMatchObject({ kind: 'rooms' });
    expect(view.transitions['o_in']?.kind).toBe('gate');
    expect(view.transitions['o_arr']?.kind).toBe('door');
    expect(view.decor?.some((d) => d.kind === 'wall')).toBe(true);
    // Partial points of an arc path take the missing coordinate from the previous point.
    expect(view.arcs?.['o_meet>o_qCoffee']?.path.every((p) => p.length === 2)).toBe(true);
    const result = validateDomainView(net, view);
    expect(result.diagnostics.filter((d) => ['V1', 'V2', 'V3', 'V4'].includes(d.rule))).toEqual([]);
    expect(result.view).toBeDefined();
  });
});
