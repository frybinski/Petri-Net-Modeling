import { describe, expect, it } from 'vitest';
import { hasErrors, validate, type DiagnosticCode, type PetriNet } from '../src';
import { makeJsonNet, makeNet } from './helpers';

const codes = (net: PetriNet): DiagnosticCode[] => validate(net).map((d) => d.code);

const good = (): PetriNet =>
  makeNet({
    places: [['p', 1, 2]],
    transitions: ['t'],
    arcs: [
      ['p', 't'],
      ['t', 'p'],
    ],
  });

describe('validate', () => {
  it('accepts a well-formed net', () => {
    expect(validate(good())).toEqual([]);
    expect(hasErrors(validate(good()))).toBe(false);
  });

  it('SCHEMA_INVALID for structurally broken input', () => {
    const broken = { ...good(), places: 'nope' } as unknown as PetriNet;
    const result = validate(broken);
    expect(result[0]?.code).toBe('SCHEMA_INVALID');
    expect(result[0]?.severity).toBe('error');
    expect(hasErrors(result)).toBe(true);
  });

  it('DUPLICATE_ID across element kinds', () => {
    const net = good();
    net.transitions[0]!.id = 'p';
    net.arcs.forEach((a) => {
      a.source = a.source === 't' ? 'p' : a.source;
      a.target = a.target === 't' ? 'p' : a.target;
    });
    expect(codes(net)).toContain('DUPLICATE_ID');
  });

  it('ARC_DANGLING when an end does not exist', () => {
    const net = good();
    net.arcs.push({ id: 'x', source: 'p', target: 'missing', weight: 1 });
    const d = validate(net).find((x) => x.code === 'ARC_DANGLING');
    expect(d?.elementId).toBe('x');
    expect(d?.severity).toBe('error');
  });

  it('ARC_NOT_BIPARTITE for place -> place and transition -> transition', () => {
    const net = makeNet({
      places: [['p'], ['q']],
      transitions: ['t', 'u'],
      arcs: [
        ['p', 'q'],
        ['t', 'u'],
      ],
    });
    const found = validate(net).filter((d) => d.code === 'ARC_NOT_BIPARTITE');
    expect(found).toHaveLength(2);
    expect(found[0]?.message).toMatch(/two places/);
    expect(found[1]?.message).toMatch(/two transitions/);
  });

  it('ARC_WEIGHT_INVALID for zero, negative and fractional weights', () => {
    for (const weight of [0, -1, 1.5]) {
      const net = good();
      net.arcs[0]!.weight = weight;
      expect(codes(net)).toContain('ARC_WEIGHT_INVALID');
    }
  });

  it('CAPACITY_INVALID for capacity below one', () => {
    const net = good();
    net.places[0]!.capacity = 0;
    expect(codes(net)).toContain('CAPACITY_INVALID');
    net.places[0]!.capacity = 2.5;
    expect(codes(net)).toContain('CAPACITY_INVALID');
  });

  it('MARKING_UNKNOWN_PLACE for tokens on a missing place', () => {
    const net = good();
    net.marking.ghost = [1];
    expect(codes(net)).toContain('MARKING_UNKNOWN_PLACE');
  });

  it('MARKING_EXCEEDS_CAPACITY when the initial marking is too large', () => {
    const net = good();
    net.marking.p = [1, 1, 1];
    const d = validate(net).find((x) => x.code === 'MARKING_EXCEEDS_CAPACITY');
    expect(d?.elementId).toBe('p');
  });

  it('DUPLICATE_NAME is a warning, per kind and ignoring empty names', () => {
    const net = makeNet({ places: [['a'], ['b']], transitions: ['a', 'b'] });
    expect(codes(net)).not.toContain('DUPLICATE_NAME');
    net.places[1]!.name = 'a';
    const d = validate(net).filter((x) => x.code === 'DUPLICATE_NAME');
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.severity === 'warning')).toBe(true);
    net.places[0]!.name = '';
    net.places[1]!.name = '  ';
    expect(codes(net)).not.toContain('DUPLICATE_NAME');
  });

  it('ISOLATED_NODE is a warning', () => {
    const net = good();
    net.places.push({ id: 'lonely', name: 'lonely', position: { x: 0, y: 0 } });
    const d = validate(net).filter((x) => x.code === 'ISOLATED_NODE');
    expect(d).toHaveLength(1);
    expect(d[0]?.elementId).toBe('lonely');
    expect(d[0]?.severity).toBe('warning');
    expect(hasErrors(d)).toBe(false);
  });

  it('MULTIPLE_ARCS is a warning for parallel arcs of the same direction only', () => {
    const net = good();
    expect(codes(net)).not.toContain('MULTIPLE_ARCS');
    net.arcs.push({ id: 'dup', source: 'p', target: 't', weight: 1 });
    const d = validate(net).filter((x) => x.code === 'MULTIPLE_ARCS');
    expect(d).toHaveLength(1);
    expect(d[0]?.elementId).toBe('dup');
    expect(d[0]?.severity).toBe('warning');
  });
});

describe('validate (JSON nets)', () => {
  const base = (): PetriNet =>
    makeJsonNet({
      types: { Order: { type: 'object' } },
      places: [
        { id: 'in', type: 'Order', tokens: [{ id: 'o1' }] },
        { id: 'out', type: 'Order' },
      ],
      transitions: [{ id: 't', guard: '$o.id != null' }],
      arcs: [
        { from: 'in', to: 't', inscription: '$o' },
        { from: 't', to: 'out', inscription: '$o' },
      ],
    });
  const find = (net: PetriNet, code: DiagnosticCode) =>
    validate(net).filter((d) => d.code === code);

  it('accepts a well-formed JSON net', () => {
    expect(validate(base())).toEqual([]);
  });

  it('TYPE_UNKNOWN for a place with a missing type', () => {
    const net = base();
    net.places[0]!.type = 'Gone';
    expect(find(net, 'TYPE_UNKNOWN')).toMatchObject([{ severity: 'error', elementId: 'in' }]);
  });

  it('TYPE_SCHEMA_INVALID for a broken schema', () => {
    const net = base();
    net.types['Order'] = { type: 'strng' };
    expect(find(net, 'TYPE_SCHEMA_INVALID')).toMatchObject([
      { severity: 'error', typeName: 'Order' },
    ]);
  });

  it('TYPE_NAME_INVALID for a bad type name', () => {
    const net = base();
    net.types['bad name'] = { type: 'string' };
    expect(find(net, 'TYPE_NAME_INVALID')).toMatchObject([
      { severity: 'error', typeName: 'bad name' },
    ]);
  });

  it('TYPE_UNUSED warns about unreferenced types', () => {
    const net = base();
    net.types['Spare'] = { type: 'string' };
    expect(find(net, 'TYPE_UNUSED')).toMatchObject([{ severity: 'warning', typeName: 'Spare' }]);
  });

  it('TOKEN_TYPE_MISMATCH for initial tokens that violate the type', () => {
    const net = base();
    net.marking['in'] = [{ id: 'o1' }, 5, 'x', 7];
    const found = find(net, 'TOKEN_TYPE_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'error', elementId: 'in' });
    expect(found[0]!.message).toMatch(/3 initial tokens/);
    expect(found[0]!.message).toMatch(/token 2/);
  });

  it('INSCRIPTION_SYNTAX for unparsable input and output inscriptions', () => {
    const net = base();
    net.arcs[0]!.inscription = 'o';
    net.arcs[1]!.inscription = '{ "id": }';
    const found = find(net, 'INSCRIPTION_SYNTAX');
    expect(found.map((d) => d.elementId).sort()).toEqual(['arc0', 'arc1']);
    expect(found[0]!.message).toMatch(/position/);
  });

  it('GUARD_SYNTAX for an unparsable guard', () => {
    const net = base();
    net.transitions[0]!.guard = '$o.id =';
    expect(find(net, 'GUARD_SYNTAX')).toMatchObject([{ severity: 'error', elementId: 't' }]);
  });

  it('VARIABLE_UNBOUND for guards and output inscriptions', () => {
    const net = base();
    net.transitions[0]!.guard = '$z > 1';
    net.arcs[1]!.inscription = '{ "id": $o.id, "by": $who }';
    const found = find(net, 'VARIABLE_UNBOUND');
    expect(found).toHaveLength(2);
    expect(found.map((d) => d.elementId).sort()).toEqual(['arc1', 't']);
    expect(found.map((d) => d.message).join(' ')).toMatch(/\$z.*\$who|\$who.*\$z/s);
  });

  it('does not flag functions, local variables or bound variables', () => {
    const net = base();
    net.arcs[1]!.inscription = '($n := $count([1]); { "n": $n, "o": $o })';
    expect(find(net, 'VARIABLE_UNBOUND')).toEqual([]);
  });

  it('WEIGHT_IGNORED warns when a weight above 1 meets an inscription', () => {
    const net = base();
    net.arcs[0]!.weight = 2;
    expect(find(net, 'WEIGHT_IGNORED')).toMatchObject([{ severity: 'warning', elementId: 'arc0' }]);
    net.arcs[0]!.weight = 1;
    expect(find(net, 'WEIGHT_IGNORED')).toEqual([]);
  });

  it('INSCRIPTION_ON_PT_NET warns for ignored fields and skips the other checks', () => {
    const net = base();
    net.profile = 'pt-net';
    net.arcs[0]!.inscription = 'not valid at all (';
    const found = find(net, 'INSCRIPTION_ON_PT_NET');
    expect(found.map((d) => d.elementId).sort()).toEqual(['arc0', 'arc1', 'in', 'out', 't']);
    expect(found.every((d) => d.severity === 'warning')).toBe(true);
    expect(validate(net).some((d) => d.code === 'INSCRIPTION_SYNTAX')).toBe(false);
  });

  it('keeps P/T nets without higher fields free of new diagnostics', () => {
    const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't']] });
    net.types = { Unused: { type: 'string' } };
    expect(validate(net)).toEqual([]);
  });
});
