import { describe, expect, it } from 'vitest';
import {
  NetOpError,
  computedPlaceRole,
  isSourceTransition,
  parseNet,
  parseNetText,
  placeRole,
  placeRoles,
  serializeNet,
  setPriority,
  setRate,
  setRole,
  setSimulationSettings,
  setTiming,
  validate,
  type DiagnosticCode,
  type PetriNet,
} from '../src';
import { makeNet } from './helpers';

const codes = (net: PetriNet): DiagnosticCode[] => validate(net).map((d) => d.code);

/** arrivals -> queue -> work (uses worker, loop) -> done */
const process = (): PetriNet =>
  makeNet({
    places: [['queue'], ['worker', 2], ['done'], ['pool']],
    transitions: ['arrive', 'work', 'refill'],
    arcs: [
      ['arrive', 'queue'],
      ['queue', 'work'],
      ['worker', 'work'],
      ['work', 'worker'],
      ['work', 'done'],
      ['pool', 'refill'],
      ['refill', 'queue'],
    ],
  });

describe('place roles', () => {
  it('computes source, sink, resource and case', () => {
    const net = process();
    expect(placeRole(net, 'queue')).toBe('case');
    expect(placeRole(net, 'worker')).toBe('resource');
    expect(placeRole(net, 'done')).toBe('sink');
    expect(placeRole(net, 'pool')).toBe('source');
  });

  it('a looped place without initial tokens is not a resource', () => {
    const net = process();
    delete net.marking['worker'];
    expect(placeRole(net, 'worker')).toBe('case');
  });

  it('role overrides resource and case but not source and sink', () => {
    const net = process();
    net.places.find((p) => p.id === 'queue')!.role = 'resource';
    net.places.find((p) => p.id === 'worker')!.role = 'case';
    net.places.find((p) => p.id === 'done')!.role = 'case';
    expect(placeRole(net, 'queue')).toBe('resource');
    expect(placeRole(net, 'worker')).toBe('case');
    expect(computedPlaceRole(net, 'worker')).toBe('resource');
    expect(placeRole(net, 'done')).toBe('sink');
    expect(placeRoles(net).get('queue')).toBe('resource');
  });

  it('recognises source transitions', () => {
    const net = process();
    expect(isSourceTransition(net, 'arrive')).toBe(true);
    expect(isSourceTransition(net, 'work')).toBe(false);
    expect(isSourceTransition(net, 'refill')).toBe(false);
  });
});

describe('timed fields', () => {
  it('round-trips through serialize and parse with a stable key order', () => {
    const net = process();
    net.transitions[0]!.timing = { kind: 'exponential', mean: 4 };
    net.transitions[0]!.rate = 30;
    net.transitions[1]!.timing = { kind: 'uniform', min: 1, max: 2 };
    net.transitions[1]!.priority = 0.5;
    net.transitions[2]!.timing = { kind: 'fixed', value: 3 };
    net.places[1]!.role = 'resource';
    net.simulation = { seed: 7, warmup: 60, startTime: '2026-01-05T08:00:00Z', caseIdPrefix: 'K-' };
    const text = serializeNet(net);
    expect(parseNet(JSON.parse(text))).toEqual(net);
    expect(serializeNet(parseNetText(text))).toBe(text);
    const t = JSON.parse(text).transitions[1];
    expect(Object.keys(t)).toEqual(['id', 'name', 'timing', 'priority', 'position']);
  });

  it('rejects unknown timing kinds when reading', () => {
    const json = JSON.parse(serializeNet(process()));
    json.transitions[0].timing = { kind: 'weibull', shape: 2 };
    expect(() => parseNet(json)).toThrow(/timing/);
  });

  it('a net without the optional fields stays valid and unchanged', () => {
    expect(validate(process())).toEqual([]);
    expect(JSON.parse(serializeNet(process()))).not.toHaveProperty('simulation');
  });
});

describe('timed diagnostics', () => {
  it('TIMING_INVALID for each kind of bad duration', () => {
    for (const timing of [
      { kind: 'fixed', value: -1 },
      { kind: 'uniform', min: 3, max: 2 },
      { kind: 'uniform', min: -1, max: 2 },
      { kind: 'exponential', mean: 0 },
    ] as const) {
      const net = process();
      net.transitions[1]!.timing = timing;
      const d = validate(net).find((x) => x.code === 'TIMING_INVALID');
      expect(d?.severity).toBe('error');
      expect(d?.elementId).toBe('work');
    }
    const ok = process();
    ok.transitions[1]!.timing = { kind: 'fixed', value: 0 };
    expect(codes(ok)).not.toContain('TIMING_INVALID');
  });

  it('PRIORITY_INVALID and RATE_INVALID', () => {
    const net = process();
    net.transitions[1]!.priority = 0;
    net.transitions[0]!.rate = -2;
    expect(codes(net)).toEqual(expect.arrayContaining(['PRIORITY_INVALID', 'RATE_INVALID']));
  });

  it('RATE_ON_NON_SOURCE warns for a transition with input places', () => {
    const net = process();
    net.transitions[1]!.rate = 10;
    const d = validate(net).find((x) => x.code === 'RATE_ON_NON_SOURCE');
    expect(d?.severity).toBe('warning');
    expect(d?.elementId).toBe('work');
  });

  it('SOURCE_WITHOUT_RATE hints only in nets that use time', () => {
    const net = process();
    expect(codes(net)).not.toContain('SOURCE_WITHOUT_RATE');
    net.transitions[1]!.timing = { kind: 'fixed', value: 5 };
    expect(validate(net).filter((d) => d.code === 'SOURCE_WITHOUT_RATE')).toHaveLength(1);
    net.transitions[0]!.rate = 12;
    expect(codes(net)).not.toContain('SOURCE_WITHOUT_RATE');
  });

  it('ROLE_OVERRIDE_UNUSUAL when a resource has no loop', () => {
    const net = process();
    net.places.find((p) => p.id === 'queue')!.role = 'resource';
    const d = validate(net).find((x) => x.code === 'ROLE_OVERRIDE_UNUSUAL');
    expect(d?.elementId).toBe('queue');
    net.places.find((p) => p.id === 'queue')!.role = 'case';
    expect(codes(net)).not.toContain('ROLE_OVERRIDE_UNUSUAL');
  });

  it('SIMULATION_INVALID for a bad seed, warm-up or start time', () => {
    const net = process();
    net.simulation = { seed: 1.5, warmup: -1, startTime: 'tomorrow-ish' };
    expect(validate(net).filter((d) => d.code === 'SIMULATION_INVALID')).toHaveLength(3);
  });
});

describe('timed net operations', () => {
  it('setTiming sets, replaces and removes', () => {
    let net = setTiming(process(), 'work', { kind: 'fixed', value: 5 });
    expect(net.transitions.find((t) => t.id === 'work')?.timing).toEqual({
      kind: 'fixed',
      value: 5,
    });
    net = setTiming(net, 'work', undefined);
    expect(net.transitions.find((t) => t.id === 'work')).not.toHaveProperty('timing');
  });

  it('rejects invalid values and unknown elements', () => {
    const net = process();
    expect(() => setTiming(net, 'work', { kind: 'exponential', mean: -1 })).toThrow(NetOpError);
    expect(() => setTiming(net, 'queue', { kind: 'fixed', value: 1 })).toThrow(NetOpError);
    expect(() => setPriority(net, 'work', 0)).toThrow(NetOpError);
    expect(() => setRate(net, 'arrive', -1)).toThrow(NetOpError);
    expect(() => setRole(net, 'work', 'case')).toThrow(NetOpError);
  });

  it('setPriority, setRate and setRole', () => {
    let net = setPriority(process(), 'work', 3);
    net = setRate(net, 'arrive', 120);
    net = setRole(net, 'queue', 'resource');
    expect(net.transitions.find((t) => t.id === 'work')?.priority).toBe(3);
    expect(net.transitions.find((t) => t.id === 'arrive')?.rate).toBe(120);
    expect(net.places.find((p) => p.id === 'queue')?.role).toBe('resource');
    net = setRole(net, 'queue', undefined);
    expect(net.places.find((p) => p.id === 'queue')).not.toHaveProperty('role');
  });

  it('setSimulationSettings merges and removes the object when empty', () => {
    let net = setSimulationSettings(process(), { seed: 5, warmup: 30 });
    net = setSimulationSettings(net, { warmup: undefined, caseIdPrefix: 'X-' });
    expect(net.simulation).toEqual({ seed: 5, caseIdPrefix: 'X-' });
    net = setSimulationSettings(net, { seed: undefined, caseIdPrefix: undefined });
    expect(net).not.toHaveProperty('simulation');
    expect(() => setSimulationSettings(net, { seed: 1.2 })).toThrow(NetOpError);
    expect(() => setSimulationSettings(net, { warmup: -1 })).toThrow(NetOpError);
    expect(() => setSimulationSettings(net, { startTime: 'x' })).toThrow(NetOpError);
  });
});
