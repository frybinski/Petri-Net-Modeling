import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, placeRoles, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  SPRITES,
  buildScene,
  counterBoxLayout,
  genericDomainView,
  netHash,
  stationInfos,
  validateDomainView,
  type DomainView,
  type FlowMarker,
} from '../src';
import { layoutContext, layoutTokens, staticLayoutState } from '../src';
import { runAnimated } from './animated-run';

const net: PetriNet = parseNetText(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'examples', 'bike-frames.pn.json'),
    'utf8',
  ),
);
const view = net.domainView as DomainView;

describe('example: the bicycle frame production, domain view (N1)', () => {
  it('passes the rules V1 to V9 without errors and without warnings, and the hash matches', () => {
    const result = validateDomainView(net, JSON.parse(JSON.stringify(view)));
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(view.netHash).toBe(netHash(net));
  });

  it('has the hall of the plan: three zones, a large CO2 counter at the top right, a dock at the store', () => {
    const labels = (view.decor ?? []).flatMap((d) => (d.kind === 'zone' ? [d.label] : []));
    expect(labels).toEqual(['Lager', 'Fertigung', 'Recycling']);
    expect(view.meta.canvas).toEqual({ width: 1200, height: 640 });
    expect(SPRITES).toContain(view.meta.entity.sprite);
    expect(view.meta.entity).toMatchObject({ singular: 'Rahmen', plural: 'Rahmen' });
    // CO2: a counter box in the upper right corner, drawn as a headline figure.
    const co2 = view.places['p_co2']!;
    expect(co2.kind).toBe('sink');
    if (co2.kind !== 'sink') throw new Error('p_co2 should be a sink box');
    const [x, y, w, h] = co2.box;
    expect(x + w).toBeGreaterThan(1100);
    expect(y).toBeLessThan(40);
    expect(counterBoxLayout(co2.box).large).toBe(true);
    expect(w * h).toBeGreaterThan(5000);
    // The docks: delivery at the store, shipping on the right.
    expect(view.transitions['t_deliver']).toMatchObject({ kind: 'dock' });
    expect(view.transitions['t_ship']).toMatchObject({ kind: 'dock' });
    const ship = view.transitions['t_ship'];
    const store = view.places['p_tubes'];
    const deliver = view.transitions['t_deliver'];
    if (ship?.kind !== 'dock' || store?.kind !== 'pool' || deliver?.kind !== 'dock')
      throw new Error();
    expect(ship.pos[0]).toBeGreaterThan(900);
    expect(Math.abs(deliver.pos[0] - store.pos[0])).toBeLessThan(40);
    expect(view.transitions['t_order']).toMatchObject({ kind: 'dock' });
  });

  it('draws every quantity place as a counter or hides it, and the machines as slots of their stations', () => {
    const roles = placeRoles(net);
    for (const place of net.places) {
      const kind = view.places[place.id]!.kind;
      if (roles.get(place.id) === 'quantity')
        expect(['pool', 'source', 'sink', 'hidden']).toContain(kind);
    }
    expect(view.places['p_tubes']!.kind).toBe('pool');
    expect(view.places['p_scrap']!.kind).toBe('pool');
    expect(view.places['p_waste']!.kind).toBe('sink');
    expect(view.places['p_space']).toEqual({
      kind: 'hidden',
      reason: 'Hilfsstelle für die Lagergrenze',
    });
    expect(view.places['p_saw']).toMatchObject({ kind: 'slots', of: 't_cut' });
    expect(view.places['p_welder']).toMatchObject({ kind: 'slots', of: 't_weld' });
    expect(view.places['p_booth']).toMatchObject({ kind: 'slots', of: 't_coat' });
    expect(view.places['p_inspector']).toMatchObject({ kind: 'slots', of: 't_check' });
    const welder = view.transitions['t_weld'];
    expect(welder && 'slots' in welder ? welder.slots?.length : 0).toBe(2);
    expect(view.places['p_orders']!.kind).toBe('queue');
    expect(view.places['p_shipped']!.kind).toBe('sink');
    for (const id of ['p_cut', 'p_welded', 'p_coated'])
      expect(view.places[id]!.kind).toBe('conveyor');
    for (const id of ['p_checked', 'p_ready']) expect(view.places[id]!.kind).toBe('buffer');
  });

  it('has the generic view too, and it is valid', () => {
    const generic = genericDomainView(net, { at: '2026-10-30T09:00:00.000Z' });
    const result = validateDomainView(net, JSON.parse(JSON.stringify(generic)));
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const id of ['p_tubes', 'p_space', 'p_scrap', 'p_waste', 'p_co2']) {
      expect(generic.places[id]!.kind).toBe('pool');
    }
  });

  it('shows the initial stock in the picture and a station is not blocked by the tube store', () => {
    const scene = buildScene(net, view, net.marking);
    // The number stays visible whatever else a counter draws (N2): the text in bold figures.
    const text = (id: string) =>
      scene.layers.tokens.find((c) => c.op === 'text' && c.elementId === id && c.weight === 700);
    expect(text('p_tubes')).toMatchObject({ text: '120' });
    // The headline figure of the CO2 counter is large.
    expect(text('p_co2')).toMatchObject({ text: '0' });
    expect((text('p_co2') as { size: number }).size).toBeGreaterThanOrEqual(24);
    // The saw takes 120 kg from the store, but those are not cases that wait in front of it.
    const context = layoutContext(net, view);
    const layout = layoutTokens(net, view, staticLayoutState(net));
    const infos = stationInfos(net, view, layout.counts, [], context);
    expect(infos.get('t_cut')!.waiting).toBe(0);
    expect(infos.get('t_rework')!.waiting).toBe(0);
  });

  it('A2: in four simulated hours every event is handled and every flow marker has its event', async () => {
    const seen = new Set<FlowMarker>();
    const { events, anim } = await runAnimated(net, view, {
      bundle: 6,
      seconds: 4 * 3600,
      onBundle: (_bundle, state) => {
        for (const flow of state.flows) seen.add(flow);
      },
    });
    expect(events.length).toBeGreaterThan(250);
    const byId = new Map(events.map((e) => [e.id, e]));
    expect(anim.handled.every((h) => byId.has(h.eventId))).toBe(true);
    // Every start and complete at a drawn station is handled somehow.
    const handled = new Set(anim.handled.map((h) => h.eventId));
    for (const event of events) {
      if (event.type !== 'start' && event.type !== 'complete') continue;
      if (view.transitions[event.transitionId]?.kind === 'hidden') continue;
      expect(handled.has(event.id), `event ${event.id}`).toBe(true);
    }
    // Amounts: markers for the tubes, the scrap, the CO2 and the waste, none for the hidden space.
    expect(seen.size).toBeGreaterThan(100);
    const places = new Set([...seen].map((f) => f.placeId));
    expect([...places].sort()).toEqual(['p_co2', 'p_scrap', 'p_tubes', 'p_waste']);
    for (const flow of seen) {
      const event = byId.get(flow.eventId);
      expect(event?.type).toBe(flow.direction === 'out' ? 'start' : 'complete');
    }
    // The counters agree with the stream.
    const co2 = events.reduce(
      (n, e) =>
        n + (e.type === 'complete' ? e.produced.filter((r) => r.placeId === 'p_co2').length : 0),
      0,
    );
    expect(anim.counters['p_co2']?.value).toBe(co2);
    expect(co2).toBeGreaterThan(100);
    // Frames are the only things that move as sprites.
    for (const entry of anim.handled) {
      if (entry.kind === 'motion') {
        expect(['p_tubes', 'p_scrap', 'p_waste', 'p_co2']).not.toContain(entry.elementId);
      }
    }
  }, 30_000);
});
