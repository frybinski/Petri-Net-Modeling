import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DECLARE_TEMPLATES,
  TEMPLATE_INFO,
  declareActivation,
  declareDfa,
  declareFormula,
  declareFormulaText,
  describeDeclare,
  equivalent,
  evaluateLtlf,
  formatDeclare,
  ltlfToDfa,
  parseDeclare,
  parseLtlf,
  templateByName,
  validateDeclare,
  type DeclareSpec,
  type DeclareTemplate,
} from '../src';

const t = (text: string): string[] => (text === '' ? [] : text.split(' '));

/**
 * The meaning of every template on traces over a, b and c (c is any other activity), written down
 * from the definition: traces the template accepts and traces it rejects.
 */
const cases: Array<{
  spec: DeclareSpec;
  positive: string[];
  negative: string[];
}> = [
  {
    spec: { template: 'existence', activities: ['a'], n: 2 },
    positive: ['a a', 'a c a', 'b a a b'],
    negative: ['', 'a', 'b b', 'c a c'],
  },
  {
    spec: { template: 'existence', activities: ['a'] },
    positive: ['a', 'c a'],
    negative: ['', 'b c'],
  },
  {
    spec: { template: 'absence', activities: ['a'], n: 0 },
    positive: ['', 'b c'],
    negative: ['a', 'b a'],
  },
  {
    spec: { template: 'absence', activities: ['a'], n: 1 },
    positive: ['', 'a', 'b a c'],
    negative: ['a a', 'a b a'],
  },
  {
    spec: { template: 'exactly', activities: ['a'], n: 2 },
    positive: ['a a', 'c a b a'],
    negative: ['', 'a', 'a a a'],
  },
  { spec: { template: 'exactly', activities: ['a'], n: 0 }, positive: ['', 'b'], negative: ['a'] },
  {
    spec: { template: 'init', activities: ['a'] },
    positive: ['a', 'a b c'],
    negative: ['', 'b a', 'c'],
  },
  {
    spec: { template: 'end', activities: ['a'] },
    positive: ['a', 'b a', 'a c a'],
    negative: ['', 'a b', 'c'],
  },
  {
    spec: { template: 'respondedExistence', activities: ['a', 'b'] },
    positive: ['', 'c', 'b', 'b a', 'a b', 'a c b'],
    negative: ['a', 'a c', 'c a'],
  },
  {
    spec: { template: 'coExistence', activities: ['a', 'b'] },
    positive: ['', 'c', 'a b', 'b a', 'a c b a'],
    negative: ['a', 'b', 'a a c'],
  },
  {
    spec: { template: 'response', activities: ['a', 'b'] },
    positive: ['', 'c', 'b', 'a b', 'a c b', 'a a b', 'b a b'],
    negative: ['a', 'a b a', 'a c'],
  },
  {
    spec: { template: 'precedence', activities: ['a', 'b'] },
    positive: ['', 'a', 'a b', 'a a b b', 'c', 'a c b'],
    negative: ['b', 'b a', 'c b a'],
  },
  {
    spec: { template: 'succession', activities: ['a', 'b'] },
    positive: ['', 'a b', 'a a b b', 'a b a b'],
    negative: ['a', 'b', 'b a', 'a b a', 'b a b'],
  },
  {
    spec: { template: 'alternateResponse', activities: ['a', 'b'] },
    positive: ['', 'a b', 'a b a b', 'a c b', 'b a b'],
    negative: ['a', 'a a b', 'a b a', 'a c a b'],
  },
  {
    spec: { template: 'alternatePrecedence', activities: ['a', 'b'] },
    positive: ['', 'a b', 'a b a b', 'a a b', 'a c b c a b'],
    negative: ['b', 'a b b', 'b a', 'a b c b'],
  },
  {
    spec: { template: 'alternateSuccession', activities: ['a', 'b'] },
    positive: ['', 'a b', 'a b a b'],
    negative: ['a a b', 'a b b', 'a', 'b'],
  },
  {
    spec: { template: 'chainResponse', activities: ['a', 'b'] },
    positive: ['', 'a b', 'c', 'a b a b', 'b a b'],
    negative: ['a', 'a c', 'a a b', 'a b a'],
  },
  {
    spec: { template: 'chainPrecedence', activities: ['a', 'b'] },
    positive: ['', 'a', 'a b', 'c a b a b', 'a a b'],
    negative: ['b', 'c b', 'a c b', 'b a'],
  },
  {
    spec: { template: 'chainSuccession', activities: ['a', 'b'] },
    positive: ['', 'a b', 'a b a b', 'c a b c'],
    negative: ['a', 'b', 'a c b', 'a a b', 'b a b'],
  },
  {
    spec: { template: 'notCoExistence', activities: ['a', 'b'] },
    positive: ['', 'a', 'b', 'a a', 'c'],
    negative: ['a b', 'b a', 'a c b'],
  },
  {
    spec: { template: 'notSuccession', activities: ['a', 'b'] },
    positive: ['', 'a', 'b', 'b a', 'b b a a', 'c'],
    negative: ['a b', 'a c b', 'b a b'],
  },
  {
    spec: { template: 'notChainSuccession', activities: ['a', 'b'] },
    positive: ['', 'a', 'a c b', 'b a', 'a a'],
    negative: ['a b', 'c a b', 'a b a'],
  },
  {
    spec: { template: 'choice', activities: ['a', 'b'] },
    positive: ['a', 'b', 'a b', 'c a'],
    negative: ['', 'c', 'c c'],
  },
  {
    spec: { template: 'exclusiveChoice', activities: ['a', 'b'] },
    positive: ['a', 'b', 'a a', 'c b'],
    negative: ['', 'c', 'a b', 'b c a'],
  },
];

describe('the automaton of every template', () => {
  it('covers all 21 templates', () => {
    expect(DECLARE_TEMPLATES).toHaveLength(21);
    for (const template of DECLARE_TEMPLATES) {
      expect(cases.some((c) => c.spec.template === template)).toBe(true);
    }
  });

  it.each(cases.map((c) => [formatDeclare(c.spec), c] as const))(
    '%s',
    (_, { spec, positive, negative }) => {
      const dfa = declareDfa(spec);
      for (const trace of positive) expect(dfa.accepts(t(trace)), `accepts "${trace}"`).toBe(true);
      for (const trace of negative) expect(dfa.accepts(t(trace)), `rejects "${trace}"`).toBe(false);
      // The defining formula says the same.
      const formula = declareFormula(spec);
      for (const trace of positive)
        expect(evaluateLtlf(formula, t(trace)), `formula "${trace}"`).toBe(true);
      for (const trace of negative)
        expect(evaluateLtlf(formula, t(trace)), `formula "${trace}"`).toBe(false);
    },
  );
});

const specArbitrary: fc.Arbitrary<DeclareSpec> = fc
  .tuple(
    fc.constantFrom(...DECLARE_TEMPLATES),
    fc.shuffledSubarray(['a', 'b', 'c', 'd'], { minLength: 2, maxLength: 2 }),
    fc.integer({ min: 0, max: 3 }),
  )
  .map(([template, [x, y], n]) => {
    const info = TEMPLATE_INFO[template];
    return {
      template,
      activities: info.arity === 1 ? [x!] : [x!, y!],
      ...(info.counted && { n: template === 'absence' ? n : Math.max(1, n) }),
    };
  });

describe('property: template automaton = LTLf formula', () => {
  it('accepts exactly the traces that satisfy the formula, on random traces', () => {
    fc.assert(
      fc.property(
        specArbitrary,
        fc.array(fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 9 }), {
          minLength: 10,
          maxLength: 10,
        }),
        (spec, traces) => {
          const dfa = declareDfa(spec);
          const formula = declareFormula(spec);
          for (const trace of traces) {
            expect(dfa.accepts(trace), `${formatDeclare(spec)} on ${trace.join(' ')}`).toBe(
              evaluateLtlf(formula, trace),
            );
          }
        },
      ),
      { numRuns: 600 },
    );
  });

  it.each(DECLARE_TEMPLATES)(
    '%s: the automaton is equivalent to the translation of the formula (all traces)',
    (template) => {
      const info = TEMPLATE_INFO[template];
      const counts = info.counted
        ? template === 'absence'
          ? [0, 1, 2, 3]
          : [1, 2, 3]
        : [undefined];
      for (const n of counts) {
        const spec: DeclareSpec = {
          template,
          activities: info.arity === 1 ? ['a'] : ['a', 'b'],
          ...(n !== undefined && { n }),
        };
        expect(
          equivalent(declareDfa(spec), ltlfToDfa(declareFormula(spec))),
          formatDeclare(spec),
        ).toBe(true);
      }
    },
  );
});

describe('parseDeclare and formatDeclare', () => {
  it('reads templates in several spellings', () => {
    expect(parseDeclare('response(a, b)')).toEqual({
      template: 'response',
      activities: ['a', 'b'],
    });
    expect(parseDeclare('Chain-Succession( a ,b )')).toEqual({
      template: 'chainSuccession',
      activities: ['a', 'b'],
    });
    expect(parseDeclare('responded existence(Approve, Create invoice)')).toEqual({
      template: 'respondedExistence',
      activities: ['Approve', 'Create invoice'],
    });
    expect(parseDeclare('not_co_existence(x,y)').template).toBe('notCoExistence');
    expect(parseDeclare('existence(Pay, 2)')).toEqual({
      template: 'existence',
      activities: ['Pay'],
      n: 2,
    });
    expect(parseDeclare('init("Start, now")')).toEqual({
      template: 'init',
      activities: ['Start, now'],
    });
  });

  it('writes what it reads', () => {
    for (const { spec } of cases) {
      expect(parseDeclare(formatDeclare(spec))).toEqual(
        TEMPLATE_INFO[spec.template].counted
          ? { ...spec, n: spec.n ?? (spec.template === 'absence' ? 0 : 1) }
          : spec,
      );
    }
    expect(formatDeclare({ template: 'init', activities: ['Start, now'] })).toBe(
      'init("Start, now")',
    );
  });

  it('rejects what it cannot read', () => {
    expect(() => parseDeclare('response')).toThrow(/template call/);
    expect(() => parseDeclare('frobnicate(a)')).toThrow(/Unknown template/);
    expect(() => parseDeclare('response(a)')).toThrow(/two activities/);
    expect(() => parseDeclare('response(a, a)')).toThrow(/different/);
    expect(() => parseDeclare('existence(a, x)')).toThrow(/not a whole number/);
    expect(() => parseDeclare('existence(a, 0)')).toThrow(/count/);
    expect(() => parseDeclare('init("a)')).toThrow(/quotation mark/);
  });

  it('finds templates by name', () => {
    expect(templateByName('Alternate response')).toBe('alternateResponse');
    expect(templateByName('nothing')).toBeUndefined();
  });

  it('validates the arity', () => {
    expect(validateDeclare({ template: 'init', activities: ['a', 'b'] })).toMatch(/one activity/);
    expect(validateDeclare({ template: 'choice', activities: ['a', ''] })).toMatch(/named/);
    expect(validateDeclare({ template: 'response', activities: ['a', 'b'] })).toBeNull();
  });
});

describe('descriptions and formulas', () => {
  it('describes every template in a sentence and as a formula that parses', () => {
    for (const template of DECLARE_TEMPLATES as readonly DeclareTemplate[]) {
      const info = TEMPLATE_INFO[template];
      const spec: DeclareSpec = {
        template,
        activities: info.arity === 1 ? ['A'] : ['A', 'B'],
        ...(info.counted && { n: 2 }),
      };
      expect(describeDeclare(spec)).toMatch(/\.$/);
      expect(parseLtlf(declareFormulaText(spec))).toEqual(declareFormula(spec));
    }
    expect(declareFormulaText({ template: 'response', activities: ['a', 'b'] })).toBe(
      'G (a -> F b)',
    );
  });
});

describe('activations', () => {
  it('counts activations and fulfilments of response and precedence', () => {
    const response: DeclareSpec = { template: 'response', activities: ['a', 'b'] };
    expect(declareActivation(response, t('a c b a a'))).toEqual({ activations: 3, fulfilled: 1 });
    const alternate: DeclareSpec = { template: 'alternateResponse', activities: ['a', 'b'] };
    // The first a gets b before the next a; the second a is followed by a third a first.
    expect(declareActivation(alternate, t('a b a a b'))).toEqual({ activations: 3, fulfilled: 2 });
    const chain: DeclareSpec = { template: 'chainResponse', activities: ['a', 'b'] };
    expect(declareActivation(chain, t('a b a c'))).toEqual({ activations: 2, fulfilled: 1 });
    const precedence: DeclareSpec = { template: 'precedence', activities: ['a', 'b'] };
    expect(declareActivation(precedence, t('b a b'))).toEqual({ activations: 2, fulfilled: 1 });
    const succession: DeclareSpec = { template: 'succession', activities: ['a', 'b'] };
    // response part: 1 a, fulfilled; precedence part: 1 b, fulfilled.
    expect(declareActivation(succession, t('a b'))).toEqual({ activations: 2, fulfilled: 2 });
    const notSuccession: DeclareSpec = { template: 'notSuccession', activities: ['a', 'b'] };
    expect(declareActivation(notSuccession, t('a b a'))).toEqual({ activations: 2, fulfilled: 1 });
    expect(declareActivation({ template: 'init', activities: ['a'] }, t('a'))).toBeNull();
  });

  it('a trace satisfies a response-like template exactly when every activation is fulfilled', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'response',
          'alternateResponse',
          'chainResponse',
          'notSuccession',
          'notChainSuccession',
        ),
        fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 9 }),
        (template, trace) => {
          const spec: DeclareSpec = { template, activities: ['a', 'b'] };
          const activation = declareActivation(spec, trace)!;
          // For response and not succession the verdict follows from the counts of the activations.
          if (
            template === 'response' ||
            template === 'notSuccession' ||
            template === 'notChainSuccession'
          ) {
            expect(declareDfa(spec).accepts(trace)).toBe(
              activation.activations === activation.fulfilled,
            );
          } else {
            // The alternate and chain variants also forbid a second activation before the answer.
            if (declareDfa(spec).accepts(trace))
              expect(activation.activations).toBe(activation.fulfilled);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
