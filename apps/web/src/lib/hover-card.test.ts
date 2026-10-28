import {
  addArc,
  addPlace,
  addToken,
  addTransition,
  createEmptyNet,
  setInitialTokens,
  updateNode,
  validate,
  type BindingResult,
  type PetriNet,
} from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { buildHoverCard } from './hover-card';

function jsonNet(): PetriNet {
  let net = createEmptyNet('json', 'json-net');
  net = addPlace(net, { id: 'p', name: 'Orders', position: { x: 0, y: 0 }, type: 'Order' });
  net = addTransition(net, {
    id: 't',
    name: 'Approve',
    position: { x: 100, y: 0 },
    guard: '$o.amount > 0',
  });
  net = addArc(net, 'p', 't', { id: 'a', inscription: '$o' });
  for (let i = 0; i < 12; i++) net = addToken(net, 'p', { id: `A-${i}` });
  return net;
}

describe('buildHoverCard', () => {
  it('lists at most ten tokens of a place and counts the rest', () => {
    const net = jsonNet();
    const card = buildHoverCard({ net, marking: net.marking, id: 'p', diagnostics: [] });
    expect(card).toMatchObject({
      kind: 'place',
      name: 'Orders',
      typeName: 'Order',
      tokenCount: 12,
    });
    expect(card?.tokens).toHaveLength(10);
    expect(card?.moreTokens).toBe(2);
  });

  it('shows the guard and the bound variables of a transition', () => {
    const net = jsonNet();
    const card = buildHoverCard({ net, marking: net.marking, id: 't', diagnostics: [] });
    expect(card).toMatchObject({ kind: 'transition', guard: '$o.amount > 0' });
    expect(card?.variables).toEqual([{ name: 'o', place: 'Orders' }]);
    expect(card?.bindings).toBeUndefined();
  });

  it('adds the number of bindings while simulating', () => {
    const net = jsonNet();
    const enabled = new Map<string, BindingResult>([
      ['t', { bindings: [{ binding: {} }, { binding: {} }] } as unknown as BindingResult],
    ]);
    expect(
      buildHoverCard({ net, marking: net.marking, id: 't', diagnostics: [], enabled })?.bindings,
    ).toBe(2);
    expect(
      buildHoverCard({ net, marking: net.marking, id: 't', diagnostics: [], enabled: new Map() })
        ?.bindings,
    ).toBe(0);
  });

  it('only shows a token count for P/T nets and reports errors', () => {
    let net = createEmptyNet('pt');
    net = addPlace(net, { id: 'p', name: 'Buffer', position: { x: 0, y: 0 }, capacity: 1 });
    net = setInitialTokens(net, 'p', 3);
    net = updateNode(net, 'p', { capacity: 1 });
    const card = buildHoverCard({
      net,
      marking: net.marking,
      id: 'p',
      diagnostics: validate(net),
    });
    expect(card).toMatchObject({ tokenCount: 3, capacity: 1, tokens: [], moreTokens: 0 });
    expect(card?.errors.length).toBeGreaterThan(0);
  });

  it('has no card for notes or unknown ids', () => {
    const net = jsonNet();
    expect(buildHoverCard({ net, marking: net.marking, id: 'nope', diagnostics: [] })).toBeNull();
  });
});
