import { createEmptyNet, type PetriNet } from '@pnm/core';
import type { PropertySpec } from '@pnm/analysis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listExamples } from '../lib/examples';
import { isStale, useAnalysisStore } from './analysis-store';
import { useEditorStore } from './editor-store';

const analysis = () => useAnalysisStore.getState();
const editor = () => useEditorStore.getState();

function example(id: string): PetriNet {
  const found = listExamples().find((e) => e.net.name && e.id === id);
  if (!found) throw new Error(`no example ${id}`);
  return found.net;
}

/** arrive -> p: unbounded, so every exploration is cut off. */
function growing(): PetriNet {
  const net = createEmptyNet('Growing');
  net.places.push({ id: 'p', name: 'P', position: { x: 0, y: 0 } });
  net.transitions.push({ id: 'arrive', name: 'Arrive', position: { x: 0, y: 0 } });
  net.arcs.push({ id: 'a', source: 'arrive', target: 'p', weight: 1 });
  return net;
}

const response: PropertySpec = {
  id: 'r',
  kind: 'declare',
  template: 'response',
  activities: ['Approve', 'Create invoice'],
};

beforeEach(() => {
  analysis().clear();
  analysis().setLimit(20000);
  analysis().setFinalMode('deadlock');
});

afterEach(() => {
  editor().stopSimulation();
  analysis().clear();
});

describe('computing the results', () => {
  it('computes structure, invariants and the state space of the producer/consumer net', async () => {
    editor().loadNet(example('producer-consumer'), null);
    await analysis().runAll();
    const state = analysis();
    expect(state.structure?.value.markedGraph).toBe(true);
    expect(state.invariants?.value.pInvariants).toHaveLength(3);
    const outcome = state.space?.value;
    expect(outcome?.report.behaviour).toMatchObject({ states: 16, edges: 28, live: true });
    // A place/transition net also gets its coverability graph.
    expect(outcome?.coverability?.bounded).toBe(true);
    expect(state.busy).toEqual({
      structure: false,
      invariants: false,
      space: false,
      check: false,
      conformance: false,
    });
    expect(state.progress).toBeNull();
  });

  it('cuts the exploration off at the chosen limit', async () => {
    editor().loadNet(growing(), null);
    analysis().setLimit(50);
    await analysis().exploreStateSpace();
    const outcome = analysis().space?.value;
    expect(outcome?.report.space.truncated).toBe(true);
    expect(outcome?.report.behaviour.states).toBe(50);
    expect(outcome?.coverability?.unboundedPlaces).toEqual(['p']);
  });

  it('can be cancelled without leaving a result or an error', async () => {
    editor().loadNet(growing(), null);
    analysis().setLimit(100000);
    const running = analysis().exploreStateSpace();
    await vi.waitFor(() => {
      expect(analysis().busy.space).toBe(true);
    });
    analysis().cancel();
    await running;
    expect(analysis().space).toBeNull();
    expect(analysis().busy.space).toBe(false);
    expect(analysis().errors.space).toBeUndefined();
  });

  it('marks a result as out of date when the net changes, not when it only moves', async () => {
    editor().loadNet(example('mutual-exclusion'), null);
    await analysis().runStructure();
    const result = analysis().structure;
    expect(isStale(result, editor().net)).toBe(false);
    const place = editor().net.places[0]!;
    editor().moveNodes({ [place.id]: { x: 999, y: 999 } });
    expect(isStale(result, editor().net)).toBe(false);
    editor().setTokens(place.id, 3);
    expect(isStale(result, editor().net)).toBe(true);
  });

  it('forgets the results when another document is loaded', async () => {
    editor().loadNet(example('traffic-light'), null);
    await analysis().runStructure();
    expect(analysis().structure).not.toBeNull();
    editor().loadNet(example('mutual-exclusion'), null);
    expect(analysis().structure).toBeNull();
  });
});

describe('checking properties', () => {
  it('checks the stored properties on the state space', async () => {
    editor().loadNet(example('order-processing'), null);
    editor().setProperties([
      response,
      {
        id: 'p',
        kind: 'declare',
        template: 'precedence',
        activities: ['Reject', 'Create invoice'],
      },
    ]);
    await analysis().checkOnStateSpace();
    const check = analysis().check;
    expect(check?.value.report.results.map((r) => r.verdict)).toEqual(['holds', 'violated']);
    expect(check?.value.report.states).toBe(216);
    expect(check?.value.report.results[1]?.counterexample?.steps).toHaveLength(9);
  });

  it('does nothing without properties', async () => {
    editor().loadNet(example('order-processing'), null);
    editor().setProperties(undefined);
    await analysis().checkOnStateSpace();
    expect(analysis().check).toBeNull();
  });

  it('checks every prefix with the end state "any marking"', async () => {
    editor().loadNet(example('producer-consumer'), null);
    editor().setProperties([
      { id: 'r', kind: 'declare', template: 'response', activities: ['produce', 'deliver'] },
    ]);
    await analysis().checkOnStateSpace();
    expect(analysis().check?.value.report.results[0]?.verdict).toBe('holds');
    expect(analysis().check?.value.report.results[0]?.vacuous).toBe(true);
    analysis().setFinalMode('all');
    await analysis().checkOnStateSpace();
    expect(analysis().check?.value.report.results[0]?.verdict).toBe('violated');
  });

  it('checks the log of a simulation run, also after the simulation was stopped', async () => {
    editor().loadNet(example('parcel-center'), null);
    editor().setProperties([
      { id: 'i', kind: 'declare', template: 'init', activities: ['Anlieferung'] },
    ]);
    // No run yet: nothing to check.
    await analysis().checkOnLog();
    expect(analysis().conformance).toBeNull();

    await editor().startSimulation();
    await vi.waitFor(() => {
      expect(editor().computing).toBe(false);
    });
    for (let i = 0; i < 6; i += 1) {
      await editor().stepNext();
      await vi.waitFor(() => {
        expect(editor().computing).toBe(false);
      });
    }
    // After six steps no parcel has been loaded yet, so the unfinished cases have to count.
    analysis().setIncludeOpen(true);
    await analysis().checkOnLog();
    const first = analysis().conformance?.value.result.properties[0];
    expect(first).toMatchObject({ ratio: 1 });
    expect(first!.total).toBeGreaterThan(0);

    editor().stopSimulation();
    analysis().clear();
    await analysis().checkOnLog();
    expect(analysis().conformance?.value.result.properties[0]?.total).toBeGreaterThan(0);
    analysis().setIncludeOpen(false);
  });
});

describe('the list of properties in the document', () => {
  it('is edited as one undo step and survives a round trip through the document', () => {
    editor().loadNet(example('traffic-light'), null);
    editor().setProperties([response]);
    expect(editor().net.properties).toEqual([response]);
    editor().undo();
    expect(editor().net.properties).toBeUndefined();
    editor().redo();
    expect(editor().net.properties).toEqual([response]);
    editor().setProperties(undefined);
    expect('properties' in editor().net).toBe(false);
  });

  it('can be edited while the simulation runs', async () => {
    editor().loadNet(example('traffic-light'), null);
    await editor().startSimulation();
    editor().setProperties([response]);
    expect(editor().net.properties).toEqual([response]);
  });
});
