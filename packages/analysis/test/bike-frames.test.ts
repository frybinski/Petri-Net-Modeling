import { createSimulation } from '@pnm/sim';
import { eventLogRows, parseEventLogCsv, toEventLogCsv } from '@pnm/io';
import { describe, expect, it } from 'vitest';
import {
  analyzeInvariants,
  analyzeStructure,
  checkLog,
  endActivities,
  tracesFromRows,
  type PropertySpec,
} from '../src';
import { example } from './helpers';

/**
 * The bicycle frame production (N1): one place invariant that is the point of the example. The
 * tube store and the free space always add up to the 200 kg of the store: the place `Lagerplatz
 * frei (kg)` is the complement of `Rohrlager (kg)`, which is what a capacity is.
 */
describe('example: the bicycle frame production', () => {
  const net = example('bike-frames');

  it('finds the invariant tube store + free space = 200 kg', () => {
    const result = analyzeInvariants(net);
    expect(result.truncated).toBe(false);
    const store = result.pInvariants.filter((invariant) =>
      invariant.terms.some((t) => t.name === 'Rohrlager (kg)'),
    );
    expect(store).toHaveLength(1);
    expect(store[0]!.value).toBe(200);
    expect(store[0]!.equation).toBe('1·Rohrlager (kg) + 1·Lagerplatz frei (kg) = 200');
    expect(store[0]!.terms.map((t) => [t.name, t.coefficient]).sort()).toEqual([
      ['Lagerplatz frei (kg)', 1],
      ['Rohrlager (kg)', 1],
    ]);
    // So neither of the two ever holds more than 200 kg.
    expect(result.bounds['p_tubes']).toBe(200);
    expect(result.bounds['p_space']).toBe(200);
    // The machines are invariants as well: a resource is taken and given back.
    expect(result.pInvariants.map((i) => i.equation).sort()).toEqual(
      [
        '1·Beschichtungskabine = 1',
        '1·Rohrlager (kg) + 1·Lagerplatz frei (kg) = 200',
        '1·Prüferin = 1',
        '1·Schweißroboter = 2',
        '1·Säge = 1',
      ].sort(),
    );
    // CO2, waste and scrap are in no invariant: they only ever grow or are used up.
    for (const id of ['p_co2', 'p_waste', 'p_scrap']) {
      expect(result.coveredPlaces).not.toContain(id);
    }
  });

  it('analyses the structure: connected, not a state machine, not a marked graph', () => {
    const structure = analyzeStructure(net);
    expect(structure.connected).toBe(true);
    expect(structure.stateMachine).toBe(false);
    expect(structure.markedGraph).toBe(false);
    expect(structure.places).toBe(17);
    expect(structure.transitions).toBe(11);
  });

  // A simulation log of one working day. Frames still under way are open and left out.
  async function traces() {
    const sim = createSimulation(net, { seed: 1 });
    const events = [...sim.initialEvents, ...(await sim.advance(8 * 3600))];
    return tracesFromRows(parseEventLogCsv(toEventLogCsv(events, net, net.simulation)));
  }

  it('has the two DECLARE properties of the plan', () => {
    const specs = (net.properties as PropertySpec[]) ?? [];
    expect(specs.map((p) => [p.kind, p.kind === 'declare' ? p.template : '', p.id])).toEqual([
      ['declare', 'precedence', 'check-before-ship'],
      ['declare', 'response', 'cut-then-ship'],
    ]);
    expect(specs.map((p) => (p.kind === 'declare' ? p.activities : []))).toEqual([
      ['Prüfen', 'Versenden'],
      ['Zuschneiden', 'Versenden'],
    ]);
    const transitionNames = new Set(net.transitions.map((t) => t.name));
    for (const spec of specs) {
      if (spec.kind === 'declare')
        for (const a of spec.activities) expect(transitionNames.has(a)).toBe(true);
    }
  });

  it('satisfies both properties for every finished frame of a simulated day', async () => {
    const all = await traces();
    expect(all.length).toBeGreaterThan(40);
    const result = checkLog(all, (net.properties as PropertySpec[]) ?? [], {
      endActivities: endActivities(net),
    });
    expect(endActivities(net)).toEqual(['Versenden']);
    expect(result.cases - result.open).toBeGreaterThan(35);
    for (const property of result.properties) {
      expect(property.error).toBeUndefined();
      expect(property.ratio, property.id).toBe(1);
      expect(property.violatingCount).toBe(0);
    }
    // The frames that went through the rework loop are among them: some are inspected twice.
    expect(all.some((t) => t.activities.filter((a) => a === 'Prüfen').length === 2)).toBe(true);
  });

  it('shows that a frame is shipped only after an inspection, and that nothing else ends a case', async () => {
    const all = await traces();
    const finished = all.filter((t) => t.activities.at(-1) === 'Versenden');
    expect(finished.length).toBeGreaterThan(35);
    for (const trace of finished) {
      expect(trace.activities.indexOf('Prüfen')).toBeGreaterThan(-1);
      expect(trace.activities.indexOf('Prüfen')).toBeLessThan(
        trace.activities.indexOf('Versenden'),
      );
    }
    // Deliveries and recycling belong to no frame: they are in no trace.
    for (const trace of all) {
      expect(trace.activities).not.toContain('Primärstahl anliefern');
      expect(trace.activities).not.toContain('Schrott aufbereiten');
    }
  });

  it('writes no row for a firing without a case (deliveries and recycling) into the event log', async () => {
    const sim = createSimulation(net, { seed: 1 });
    const events = [...sim.initialEvents, ...(await sim.advance(8 * 3600))];
    const rows = eventLogRows(events, net, net.simulation);
    const activities = new Set(rows.map((r) => r.activity));
    expect(activities.has('Primärstahl anliefern')).toBe(false);
    expect(activities.has('Schrott aufbereiten')).toBe(false);
    expect(activities.has('Zuschneiden')).toBe(true);
    expect(events.some((e) => e.type === 'start' && e.transitionId === 't_deliver')).toBe(true);
  });
});
