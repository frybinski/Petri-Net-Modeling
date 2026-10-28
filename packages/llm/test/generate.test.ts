import { placeRoles, type PetriNet } from '@pnm/core';
import { validateDomainView, type DomainView } from '@pnm/domain';
import { describe, expect, it } from 'vitest';
import {
  LlmError,
  generateDomainView,
  parseGeneration,
  toGenerationRecord,
  type GenerateProgress,
} from '../src';
import { FAKE_MODEL, createFakeProvider, type FakeScript } from '../src/testing';
import { EXAMPLE_IDS, loadExample, modelAnswer } from './helpers';

/** A clock that advances by 10 ms per reading, so that results are reproducible. */
function clock(): () => number {
  let t = Date.UTC(2026, 9, 28, 12, 0, 0);
  return () => {
    t += 10;
    return t;
  };
}

type Section = Record<string, unknown>;

function sectionOf(answer: Record<string, unknown>, name: 'places' | 'transitions'): Section {
  return answer[name] as Section;
}

/** The first place that holds cases, and the first transition with a box. */
function targets(net: PetriNet, view: DomainView): { place: string; station: string } {
  const roles = placeRoles(net);
  const place = net.places.find((p) => roles.get(p.id) === 'case')?.id;
  const station = Object.entries(view.transitions).find(([, t]) => 'box' in t)?.[0];
  if (!place || !station) throw new Error('example has no case place or station');
  return { place, station };
}

/** The answer of the model with two mistakes: a wrong kind (V4) and a box outside the canvas (V5). */
function brokenAnswer(net: PetriNet, view: DomainView): Record<string, unknown> {
  const { place, station } = targets(net, view);
  const answer = modelAnswer(view);
  sectionOf(answer, 'places')[place] = { kind: 'slots', of: station };
  const entry = sectionOf(answer, 'transitions')[station] as { box: number[] };
  entry.box = [view.meta.canvas.width + 40, 20, 80, 60];
  return answer;
}

function fixes(net: PetriNet, view: DomainView): Record<string, unknown> {
  const { place, station } = targets(net, view);
  return {
    places: { [place]: view.places[place] },
    transitions: { [station]: view.transitions[station] },
  };
}

function errorsOf(net: PetriNet, view: unknown) {
  return validateDomainView(net, view).diagnostics.filter((d) => d.severity === 'error');
}

describe.each(EXAMPLE_IDS)('A6 with the fake provider: %s', (id) => {
  const { net, view } = loadExample(id);

  it('passes the check in round 2 after a repair, with no errors left', async () => {
    const provider = createFakeProvider([
      { json: brokenAnswer(net, view) },
      { json: fixes(net, view) },
    ]);
    const result = await generateDomainView(net, provider, {
      description: 'Test',
      now: clock(),
    });
    expect(result.rounds).toHaveLength(2);
    expect(
      result.rounds[0]?.diagnostics.filter((d) => d.severity === 'error').map((d) => d.rule),
    ).toEqual(expect.arrayContaining(['V4', 'V5']));
    expect(result.rounds[1]?.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(errorsOf(net, result.view)).toEqual([]);
    // Nothing of the model was replaced; at most arcs that it left out are drawn by the tool.
    expect(result.filled.filter((p) => !p.startsWith('arcs.'))).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.fellBack).toBe(false);
    // Every entry is the model's.
    const nodes = Object.entries(result.view.provenance).filter(
      ([key]) => !key.startsWith('arcs.'),
    );
    expect(new Set(nodes.map(([, p]) => p.source))).toEqual(new Set(['llm']));
    expect(new Set(nodes.map(([, p]) => p.model))).toEqual(new Set([FAKE_MODEL]));
    expect(nodes).toHaveLength(net.places.length + net.transitions.length);
    // The repair got the findings, not the first prompt.
    const second = provider.calls[1];
    expect(second?.user).toContain('V4');
    expect(second?.user).toContain('## Findings of the checking program');
    expect(second?.schema).toBeUndefined();
    expect(provider.calls[0]?.schema).toBeDefined();
  });

  it('falls back to filling when three rounds do not help', async () => {
    const provider = createFakeProvider([{ json: brokenAnswer(net, view) }]);
    const { place, station } = targets(net, view);
    const result = await generateDomainView(net, provider, { description: 'Test', now: clock() });
    expect(result.rounds).toHaveLength(3);
    expect(provider.calls).toHaveLength(3);
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(result.dropped).toEqual(
      expect.arrayContaining([`places.${place}`, `transitions.${station}`]),
    );
    expect(result.filled).toEqual(
      expect.arrayContaining([`places.${place}`, `transitions.${station}`]),
    );
    expect(result.view.provenance[`places.${place}`]?.source).toBe('generic');
    // The rest stays the model's.
    const others = Object.keys(view.places).find((k) => k !== place) ?? '';
    expect(result.view.provenance[`places.${others}`]?.source).toBe('llm');
    expect(result.view.provenance[`places.${others}`]?.model).toBe(FAKE_MODEL);
    expect(result.fellBack).toBe(false);
  });
});

describe('generateDomainView', () => {
  const { net, view } = loadExample('parcel-center');
  const { place, station } = targets(net, view);

  it('accepts a valid answer in round 1', async () => {
    const provider = createFakeProvider([{ json: modelAnswer(view), model: 'qwen-test' }]);
    const result = await generateDomainView(net, provider, { description: 'Hall 2', now: clock() });
    expect(result.rounds).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(result.model).toBe('qwen-test');
    expect(result.rounds[0]).toMatchObject({ round: 1, kind: 'generate', mode: 'schema' });
    expect(result.view.places).toEqual(view.places);
    expect(result.view.transitions).toEqual(view.transitions);
    expect(result.view.provenance[`places.${place}`]).toEqual({
      source: 'llm',
      model: 'qwen-test',
      at: result.startedAt,
    });
    expect(provider.calls[0]?.user).toContain('Hall 2');
    expect(result.prompt.user).toBe(provider.calls[0]?.user);
  });

  it('does not show the model the answer: an example with the net itself is left out', async () => {
    const provider = createFakeProvider([{ json: modelAnswer(view) }]);
    await generateDomainView(net, provider, { description: 'x', now: clock() });
    const user = provider.calls[0]?.user ?? '';
    expect(user).toContain('### Example 1: Smart Office');
    expect(user).not.toContain('Paketzentrum\n');
    expect(user.match(/### Example/g)).toHaveLength(1);
    const other = loadExample('order-processing');
    const second = createFakeProvider([{ text: 'no' }]);
    await generateDomainView(other.net, second, { description: 'x', maxRounds: 1, now: clock() });
    expect(second.calls[0]?.user.match(/### Example/g)).toHaveLength(2);
  });

  it('sets the hash of the net, whatever the model wrote', async () => {
    const answer = { ...modelAnswer(view), netHash: 'fnv1a64:0000000000000000', provenance: {} };
    const provider = createFakeProvider([{ json: answer }]);
    const result = await generateDomainView(net, provider, { description: '', now: clock() });
    expect(validateDomainView(net, result.view).diagnostics.some((d) => d.rule === 'V7')).toBe(
      false,
    );
  });

  it('merges a partial repair: only the named entries change', async () => {
    const answer = brokenAnswer(net, view);
    const provider = createFakeProvider([{ json: answer }, { json: fixes(net, view) }]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    const otherPlace = Object.keys(view.places).find((k) => k !== place) ?? '';
    expect(result.view.places[otherPlace]).toEqual(view.places[otherPlace]);
    expect(result.view.places[place]).toEqual(view.places[place]);
    expect(result.view.transitions[station]).toEqual(view.transitions[station]);
    expect(result.rounds[1]?.written).toEqual(
      expect.arrayContaining([`places.${place}`, `transitions.${station}`]),
    );
    expect(result.rounds[1]?.kind).toBe('repair');
  });

  it('reports a schema problem and a rule problem in the same round', async () => {
    const answer = modelAnswer(view);
    sectionOf(answer, 'places')[place] = {
      kind: 'queue',
      path: [
        [0, 0],
        [100, 0],
      ],
      duration: 5,
    };
    sectionOf(answer, 'transitions')[station] = {
      kind: 'station',
      box: [view.meta.canvas.width + 10, 0, 50, 50],
    };
    const provider = createFakeProvider([{ json: answer }, { json: fixes(net, view) }]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    const first = result.rounds[0]?.diagnostics ?? [];
    const v1 = first.find((d) => d.rule === 'V1');
    expect(v1?.path).toBe(`places.${place}.duration`);
    expect(v1?.message).toMatch(/behaviour/);
    expect(first.some((d) => d.rule === 'V5' && d.path.startsWith(`transitions.${station}`))).toBe(
      true,
    );
    // The missing entry is not reported a second time.
    expect(first.some((d) => d.rule === 'V3' && d.elementId === place)).toBe(false);
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(result.filled.filter((p) => !p.startsWith('arcs.'))).toEqual([]);
  });

  it('asks again with the first prompt if the answer is no JSON', async () => {
    const provider = createFakeProvider([
      { text: 'Sorry, I cannot draw.' },
      { json: modelAnswer(view) },
    ]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    expect(result.rounds[0]?.error).toMatch(/no JSON/);
    expect(result.rounds[0]?.diagnostics[0]?.rule).toBe('V1');
    expect(provider.calls[1]?.system).toBe(provider.calls[0]?.system);
    expect(provider.calls[1]?.user).toContain('## Previous answer');
    expect(result.rounds[1]?.kind).toBe('generate');
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(result.fellBack).toBe(false);
  });

  it('falls back to the generic view if no round delivers anything', async () => {
    const provider = createFakeProvider([{ text: 'no' }]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    expect(result.rounds).toHaveLength(3);
    expect(result.fellBack).toBe(true);
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(new Set(Object.values(result.view.provenance).map((p) => p.source))).toEqual(
      new Set(['generic']),
    );
    expect(result.filled.length).toBe(Object.keys(result.view.provenance).length);
  });

  it('understands an answer wrapped in an object and in a code block', async () => {
    const wrapped = createFakeProvider([{ json: { domainView: modelAnswer(view) } }]);
    const r1 = await generateDomainView(net, wrapped, { description: 'x', now: clock() });
    expect(r1.rounds).toHaveLength(1);
    const fenced = createFakeProvider([
      { text: `Here is the view:\n\`\`\`json\n${JSON.stringify(modelAnswer(view))}\n\`\`\`` },
    ]);
    const r2 = await generateDomainView(net, fenced, { description: 'x', now: clock() });
    expect(r2.rounds).toHaveLength(1);
    expect(r2.fellBack).toBe(false);
  });

  it('stops after maxRounds and respects 1', async () => {
    const provider = createFakeProvider([{ json: brokenAnswer(net, view) }]);
    const result = await generateDomainView(net, provider, {
      description: 'x',
      maxRounds: 1,
      now: clock(),
    });
    expect(provider.calls).toHaveLength(1);
    expect(result.rounds).toHaveLength(1);
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(result.filled.length).toBeGreaterThan(0);
  });

  it('keeps going with filling when the provider fails in round 2', async () => {
    const provider = createFakeProvider([
      { json: brokenAnswer(net, view) },
      { error: 'network', message: 'connection lost' },
    ]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[1]?.error).toBe('connection lost');
    expect(result.notes.join(' ')).toMatch(/Round 2 failed.*connection lost/);
    expect(errorsOf(net, result.view)).toEqual([]);
    expect(result.filled).toEqual(expect.arrayContaining([`places.${place}`]));
    expect(result.fellBack).toBe(false);
  });

  it('throws a provider error of round 1', async () => {
    const provider = createFakeProvider([{ error: 'auth', message: 'bad key' }]);
    const error = await generateDomainView(net, provider, { description: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('auth');
  });

  it('throws when the caller cancels, in any round', async () => {
    const controller = new AbortController();
    const provider = createFakeProvider([{ json: brokenAnswer(net, view) }, { hang: true }]);
    const pending = generateDomainView(net, provider, {
      description: 'x',
      signal: controller.signal,
      onProgress: (p) => {
        if (p.round === 2 && p.phase === 'waiting') controller.abort();
      },
    });
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    const before = createFakeProvider([{ json: modelAnswer(view) }]);
    await expect(
      generateDomainView(net, before, { description: 'x', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(before.calls).toHaveLength(0);
  });

  it('reports the phases in order', async () => {
    const seen: GenerateProgress[] = [];
    const provider = createFakeProvider([
      { json: brokenAnswer(net, view) },
      { json: fixes(net, view) },
    ]);
    await generateDomainView(net, provider, {
      description: 'x',
      now: clock(),
      onProgress: (p) => seen.push(p),
    });
    expect(seen.map((p) => `${p.round}:${p.phase}`)).toEqual([
      '1:prompt',
      '1:waiting',
      '1:validating',
      '1:repairing',
      '2:waiting',
      '2:validating',
      '2:filling',
      '2:done',
    ]);
    expect(seen.find((p) => p.phase === 'repairing')?.diagnostics?.length).toBeGreaterThan(0);
  });

  it('drops scenery that breaks a rule and says so', async () => {
    const answer = modelAnswer(view);
    const decor = (answer['decor'] as unknown[]).slice();
    decor[1] = { kind: 'zone', rect: [-50, 0, 100, 100] };
    decor[2] = { kind: 'wall', segs: [[0, 0, 10, 10]], thickness: 4 };
    answer['decor'] = decor;
    const provider = createFakeProvider([{ json: answer }]);
    const result = await generateDomainView(net, provider, {
      description: 'x',
      maxRounds: 1,
      now: clock(),
    });
    expect(result.dropped).toEqual(['decor[1]', 'decor[2]']);
    expect(result.view.decor).toHaveLength(decor.length - 2);
    expect(errorsOf(net, result.view)).toEqual([]);
  });

  it('replaces a missing or invalid header and keeps the rest', async () => {
    const answer = modelAnswer(view);
    delete answer['meta'];
    const provider = createFakeProvider([{ json: answer }]);
    const result = await generateDomainView(net, provider, {
      description: 'x',
      maxRounds: 1,
      now: clock(),
    });
    expect(result.rounds[0]?.diagnostics.some((d) => d.rule === 'V1' && d.path === 'meta')).toBe(
      true,
    );
    expect(result.notes.join(' ')).toMatch(/header/);
    expect(result.view.meta.viewName).toBe('Generic view');
    expect(result.view.provenance[`places.${place}`]?.source).toBe('llm');
    expect(errorsOf(net, result.view)).toEqual([]);
  });

  it('draws the arcs the model left out, as generic entries', async () => {
    const answer = modelAnswer(view);
    delete answer['arcs'];
    const provider = createFakeProvider([{ json: answer }]);
    const result = await generateDomainView(net, provider, { description: 'x', now: clock() });
    expect(Object.keys(result.view.arcs ?? {}).length).toBeGreaterThan(5);
    expect(result.filled.every((p) => p.startsWith('arcs.'))).toBe(true);
    expect(errorsOf(net, result.view)).toEqual([]);
  });

  it('gives the same result for the same script', async () => {
    const run = async () => {
      const provider = createFakeProvider([
        { json: brokenAnswer(net, view) },
        { json: fixes(net, view) },
      ]);
      return generateDomainView(net, provider, { description: 'same', now: clock() });
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it('takes the script as functions of the request, too', async () => {
    const script: FakeScript = [
      (request) => ({
        json: request.user.includes('Findings') ? fixes(net, view) : brokenAnswer(net, view),
      }),
      (request) => ({
        json: request.user.includes('Findings') ? fixes(net, view) : brokenAnswer(net, view),
      }),
    ];
    const result = await generateDomainView(net, createFakeProvider(script), {
      description: 'x',
      now: clock(),
    });
    expect(result.rounds).toHaveLength(2);
  });
});

describe('generation record', () => {
  const { net, view } = loadExample('smart-office');

  it('keeps prompt, model, rounds and paths, and reads back', async () => {
    const provider = createFakeProvider([
      { json: brokenAnswer(net, view) },
      { json: fixes(net, view) },
    ]);
    const result = await generateDomainView(net, provider, {
      description: 'An office',
      now: clock(),
    });
    const record = toGenerationRecord(result, {
      description: 'An office',
      baseUrl: 'https://user:hunter2@api.example.com/v1/?key=abc#x',
    });
    expect(record.baseUrl).toBe('https://api.example.com/v1');
    expect(record.model).toBe(FAKE_MODEL);
    expect(record.rounds).toHaveLength(2);
    expect(record.prompt.user).toContain('An office');
    const roundTrip = parseGeneration(JSON.parse(JSON.stringify(record)));
    expect(roundTrip).toEqual(record);
    const text = JSON.stringify(record);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('abc');
  });

  it('rejects malformed records', () => {
    expect(parseGeneration({ model: 'x' })).toBeNull();
    expect(parseGeneration(undefined)).toBeNull();
    expect(parseGeneration('text')).toBeNull();
  });
});
