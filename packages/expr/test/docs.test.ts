import { describe, expect, it } from 'vitest';
import { compile, evaluateOutput, evaluateGuard } from '../src';

/** The examples of docs/expressions.md must keep working. */
describe('documented expressions', () => {
  const o = {
    id: 'A-1',
    amount: 12.5,
    customer: 'c1',
    country: 'DE',
    items: [{ price: 5 }, { price: 20 }],
    'first name': 'Ada',
  };
  const c = { id: 'c1', name: 'Ada' };

  it('evaluates the guard examples', async () => {
    for (const source of [
      '$o.amount > 0',
      '$o.customer = $c.id',
      '$o.amount > 0 and $o.country in ["DE", "AT", "CH"]',
      '$count($o.items) > 0',
    ]) {
      expect(await evaluateGuard(compile(source), { o, c }), source).toEqual({ ok: true });
    }
  });

  it('evaluates the access examples', async () => {
    expect(await compile('$o.items[0].price').evaluate({ o })).toBe(5);
    expect(await compile('$o.items[price > 10]').evaluate({ o })).toEqual({ price: 20 });
    expect(await compile('$o."first name"').evaluate({ o })).toBe('Ada');
    expect(await compile('$o.id & "-paid"').evaluate({ o })).toBe('A-1-paid');
    expect(await compile('[1..3]').evaluate({})).toEqual([1, 2, 3]);
  });

  it('evaluates the output examples', async () => {
    expect(
      await evaluateOutput(compile('{ "order": $o.id, "to": $c.name, "total": $o.amount }'), {
        o,
        c,
      }),
    ).toEqual({
      tokens: [{ order: 'A-1', to: 'Ada', total: 12.5 }],
    });
    const copy = await evaluateOutput(compile('$o ~> | $ | { "approved": true } |'), { o });
    expect(copy).toMatchObject({ tokens: [{ id: 'A-1', approved: true }] });
    expect(await evaluateOutput(compile('$o.items'), { o })).toEqual({
      tokens: [{ price: 5 }, { price: 20 }],
    });
    expect(compile('$o ~> | $ | { "approved": true } |').variables).toEqual(['o']);
  });
});
