import { addArc, addPlace, addTransition, createEmptyNet, setInscription } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { arcDirection, boundVariables, checkInscription, truncate } from './inscriptions';

function sample() {
  let net = createEmptyNet('n', 'json-net');
  net = addPlace(net, { id: 'p', name: 'Orders', position: { x: 0, y: 0 } });
  net = addPlace(net, { id: 'q', name: 'Customers', position: { x: 0, y: 100 } });
  net = addPlace(net, { id: 'r', name: 'Out', position: { x: 300, y: 0 } });
  net = addTransition(net, { id: 't', position: { x: 150, y: 0 } });
  net = addArc(net, 'p', 't', { id: 'a1' });
  net = addArc(net, 'q', 't', { id: 'a2' });
  net = addArc(net, 't', 'r', { id: 'a3' });
  net = setInscription(net, 'a1', '$o');
  net = setInscription(net, 'a2', '$c, $d');
  return net;
}

describe('boundVariables', () => {
  it('lists the variables of the input arcs with their places', () => {
    expect(boundVariables(sample(), 't')).toEqual([
      { name: 'o', arcId: 'a1', placeId: 'p', placeName: 'Orders' },
      { name: 'c', arcId: 'a2', placeId: 'q', placeName: 'Customers' },
      { name: 'd', arcId: 'a2', placeId: 'q', placeName: 'Customers' },
    ]);
  });

  it('ignores unparsable inscriptions and repeated names', () => {
    let net = sample();
    net = setInscription(net, 'a2', '$o, nonsense');
    expect(boundVariables(net, 't').map((v) => v.name)).toEqual(['o']);
    net = setInscription(net, 'a2', '$o');
    expect(boundVariables(net, 't').map((v) => v.arcId)).toEqual(['a1']);
  });
});

describe('arcDirection', () => {
  it('tells input from output arcs', () => {
    const net = sample();
    expect(arcDirection(net, 'a1')).toBe('input');
    expect(arcDirection(net, 'a3')).toBe('output');
    expect(arcDirection(net, 'nope')).toBeNull();
  });
});

describe('checkInscription', () => {
  it('accepts empty text', () => {
    expect(checkInscription('guard', '  ', [])).toMatchObject({ error: null, warning: null });
  });

  it('flags input inscriptions that are not variables, with a range', () => {
    const result = checkInscription('input', '$a, b', []);
    expect(result.error).toMatch(/not a variable/);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ from: 4, to: 5, severity: 'error' }),
    ]);
  });

  it('reports the variables of a valid input inscription', () => {
    expect(checkInscription('input', '$a, $b, $a', []).variables).toEqual(['a', 'b']);
  });

  it('flags syntax errors in expressions with a range', () => {
    const result = checkInscription('guard', '$o.amount >', ['o']);
    expect(result.error).toMatch(/end of expression/i);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', from: 10, to: 11 });
  });

  it('warns about variables no input arc binds, at each occurrence', () => {
    const result = checkInscription('output', '{ "a": $x, "b": $x + $o }', ['o']);
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/\$x is not bound/);
    expect(result.diagnostics.map((d) => [d.from, d.to])).toEqual([
      [7, 9],
      [16, 18],
    ]);
  });

  it('does not match longer names when marking an unbound variable', () => {
    const result = checkInscription('guard', '$x > $xy', ['xy']);
    expect(result.diagnostics.map((d) => d.from)).toEqual([0]);
  });

  it('accepts expressions over bound variables and built-in functions', () => {
    expect(checkInscription('guard', '$count($o.items) > 0', ['o'])).toMatchObject({
      error: null,
      warning: null,
    });
  });
});

describe('truncate', () => {
  it('collapses whitespace and cuts long text', () => {
    expect(truncate('a   b\n c', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
