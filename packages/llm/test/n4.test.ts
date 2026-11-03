import { placeRoles } from '@pnm/core';
import {
  applyChoices,
  choiceDeviations,
  counterPlaces,
  defaultChoices,
  stagePlaces,
  validateDomainView,
  type DomainView,
  type ViewChoices,
} from '@pnm/domain';
import { describe, expect, it } from 'vitest';
import {
  MAX_NOTES_PER_ANSWER,
  buildConceptPrompt,
  buildPrompt,
  answerSchema,
  composeDescription,
  generateDomainView,
  notesOf,
  parseGeneration,
  readConcepts,
  suggestConcepts,
  toGenerationRecord,
  defaultExamples,
} from '../src';
import { createFakeProvider } from '../src/testing';
import { loadExample, modelAnswer } from './helpers';

const { net, view } = loadExample('parcel-center');

function withEntity(emoji: string): Record<string, unknown> {
  const answer = modelAnswer(view);
  const meta = answer['meta'] as { entity: Record<string, unknown> };
  meta.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji };
  return answer;
}

describe('the notes of an answer (N4)', () => {
  it('reads strings, trims them, drops duplicates and cuts the list', () => {
    expect(notesOf({ notes: ['  a  b ', 'a b', '', 3, 'c'] })).toEqual(['a b', 'c']);
    expect(notesOf({ notes: 'one' })).toEqual(['one']);
    expect(notesOf({ notes: ['1', '2', '3', '4', '5', '6', '7'] })).toHaveLength(
      MAX_NOTES_PER_ANSWER,
    );
    expect(notesOf({ notes: ['x'.repeat(1000)] })[0]).toHaveLength(300);
    expect(notesOf({ domainView: { places: {}, notes: ['wrapped'] } })).toEqual(['wrapped']);
    expect(notesOf(undefined)).toEqual([]);
    expect(notesOf({ notes: {} })).toEqual([]);
  });

  it('are taken out of the view, collected over all rounds and kept in the record', async () => {
    const broken = modelAnswer(view);
    const place = Object.keys(view.places).find((id) =>
      ['queue', 'conveyor', 'buffer'].includes(view.places[id]!.kind),
    )!;
    (broken['places'] as Record<string, unknown>)[place] = { kind: 'slots', of: 'nope' };
    broken['notes'] = ['The color pink does not exist as a tint.', 'Same note'];
    const provider = createFakeProvider([
      { json: broken },
      {
        json: {
          places: { [place]: view.places[place] },
          notes: ['Same note', 'The arrangement is approximate.'],
        },
      },
    ]);
    const result = await generateDomainView(net, provider, { description: 'x' });
    expect(result.rounds).toHaveLength(2);
    expect(result.modelNotes).toEqual([
      'The color pink does not exist as a tint.',
      'Same note',
      'The arrangement is approximate.',
    ]);
    expect(JSON.stringify(result.view)).not.toContain('notes');
    expect(validateDomainView(net, result.view).ok).toBe(true);
    const record = toGenerationRecord(result, { description: 'x', baseUrl: 'http://h/v1' });
    expect(record.modelNotes).toEqual(result.modelNotes);
    expect(parseGeneration(JSON.parse(JSON.stringify(record)))).toEqual(record);
    // The JSON Schema asks for them as an option.
    expect(JSON.stringify(provider.calls[0]!.schema)).toContain('"notes"');
  });

  it('are absent from the record when the model says nothing', async () => {
    const provider = createFakeProvider([{ json: modelAnswer(view) }]);
    const result = await generateDomainView(net, provider, { description: 'x' });
    expect(result.modelNotes).toEqual([]);
    const record = toGenerationRecord(result, { description: 'x', baseUrl: 'http://h/v1' });
    expect(record).not.toHaveProperty('modelNotes');
    expect(record).not.toHaveProperty('mode');
  });

  it('are not mistaken for the view when the answer holds nothing else', async () => {
    const provider = createFakeProvider([{ json: { notes: ['I cannot do this.'] } }]);
    const result = await generateDomainView(net, provider, { description: 'x', maxRounds: 1 });
    expect(result.fellBack).toBe(true);
    expect(result.modelNotes).toEqual(['I cannot do this.']);
  });
});

describe('an answer with emoji', () => {
  it('passes the check, and the emoji stays the model’s', async () => {
    const answer = withEntity('🦄');
    const place = Object.keys(view.places).find((id) =>
      ['queue', 'conveyor', 'buffer'].includes(view.places[id]!.kind),
    )!;
    (answer['places'] as Record<string, unknown>)[place] = {
      ...(view.places[place] as object),
      appearance: { emoji: '🌈' },
    };
    const result = await generateDomainView(net, createFakeProvider([{ json: answer }]), {
      description: 'The parcels are unicorns',
    });
    expect(result.rounds).toHaveLength(1);
    expect(result.view.meta.entity).toMatchObject({ emoji: '🦄' });
    expect(result.view.meta.entity).not.toHaveProperty('sprite');
    expect((result.view.places[place] as { appearance?: unknown }).appearance).toEqual({
      emoji: '🌈',
    });
    expect(result.view.provenance[`places.${place}`]?.source).toBe('llm');
  });

  it('is told by rule V12 when the emoji is wrong, and repairs it', async () => {
    const provider = createFakeProvider([
      { json: withEntity('🦄🦄') },
      { json: { meta: modelAnswer(view)['meta'] } },
    ]);
    const result = await generateDomainView(net, provider, { description: 'x' });
    expect(result.rounds[0]!.diagnostics.map((d) => d.rule)).toContain('V12');
    expect(provider.calls[1]!.user).toContain('V12');
    expect(result.rounds[1]!.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // A generation record with V12 findings can still be read back.
    const record = toGenerationRecord(result, { description: 'x', baseUrl: 'http://h/v1' });
    expect(parseGeneration(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
});

function guidedChoices(): ViewChoices {
  const choices = defaultChoices(net, null);
  choices.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
  const stage = stagePlaces(net)[1]!;
  choices.stages[stage] = { sprite: 'document', tint: 'ok' };
  const counter = counterPlaces(net)[0]!;
  choices.counters[counter] = {
    ...choices.counters[counter]!,
    style: 'pictogram',
    per: 5,
    emoji: '🌈',
  };
  choices.additions = 'Keep it friendly.';
  return choices;
}

describe('the binding choices of the guided way', () => {
  it('go into the request as a section, and the description is made of them', () => {
    const choices = guidedChoices();
    const prompt = buildPrompt({
      net,
      description: composeDescription(choices),
      canvas: { width: 1200, height: 640 },
      examples: defaultExamples(),
      schema: answerSchema(),
      choices,
    });
    expect(prompt.user).toContain('## Binding choices');
    expect(prompt.user).toContain('"emoji" "🦄"');
    expect(prompt.user).toContain('"emoji":"🌈"');
    expect(prompt.user).toContain('Keep it friendly.');
    expect(prompt.user).toContain('"appearance" {"sprite":"document","tint":"ok"}');
    expect(composeDescription(choices)).toContain('Keep it friendly.');
    // Without choices there is no such section.
    expect(
      buildPrompt({
        net,
        description: 'x',
        canvas: { width: 1, height: 1 },
        examples: [],
        schema: {},
      }).user,
    ).not.toContain('Binding choices');
  });

  it('replace what the model wrote and tell each deviation', async () => {
    const choices = guidedChoices();
    // The model keeps the parcel and shows the first counter as a fill.
    const provider = createFakeProvider([{ json: modelAnswer(view) }]);
    const result = await generateDomainView(net, provider, { description: '', choices });
    expect(result.view.meta.entity).toMatchObject({ emoji: '🦄' });
    const stage = stagePlaces(net)[1]!;
    expect((result.view.places[stage] as { appearance?: unknown }).appearance).toEqual({
      sprite: 'document',
      tint: 'ok',
    });
    const counter = counterPlaces(net)[0]!;
    expect((result.view.places[counter] as { display?: unknown }).display).toMatchObject({
      style: 'pictogram',
      per: 5,
      emoji: '🌈',
    });
    expect(result.notes.filter((n) => n.startsWith('Choice applied:')).length).toBeGreaterThan(1);
    expect(result.notes.join('\n')).toContain('🦄');
    expect(validateDomainView(net, result.view).ok).toBe(true);
    // The provenance of the entries stays the model's.
    expect(result.view.provenance[`places.${stage}`]?.source).toBe('llm');
    const record = toGenerationRecord(result, {
      description: composeDescription(choices),
      baseUrl: 'http://h/v1',
      mode: 'guided',
      choices,
      concept: 'Rainbow',
    });
    const read = parseGeneration(JSON.parse(JSON.stringify(record)));
    expect(read?.mode).toBe('guided');
    expect(read?.choices).toEqual(choices);
    expect(read?.concept).toBe('Rainbow');
  });

  it('say nothing when the model did what was chosen', async () => {
    const choices = guidedChoices();
    const applied = applyChoices(net, view, choices, { at: 'x', provenance: 'keep' }).view;
    expect(choiceDeviations(net, applied, choices)).toEqual([]);
    const answer = modelAnswer(applied);
    const result = await generateDomainView(net, createFakeProvider([{ json: answer }]), {
      description: '',
      choices,
    });
    expect(result.notes.filter((n) => n.startsWith('Choice applied:'))).toEqual([]);
  });

  it('are not applied when they break a rule, and the view stays valid', async () => {
    const choices = guidedChoices();
    const sink = counterPlaces(net).find((id) => placeRoles(net).get(id) === 'sink')!;
    choices.counters[sink] = {
      ...choices.counters[sink]!,
      style: 'pictogram',
      icon: 'co2',
      per: 3,
    };
    const result = await generateDomainView(
      net,
      createFakeProvider([{ json: modelAnswer(view) }]),
      { description: '', choices },
    );
    expect(validateDomainView(net, result.view).ok).toBe(true);
    expect(result.notes.join('\n')).toMatch(/not applied|Choice applied/);
  });
});

describe('concepts', () => {
  const stage = stagePlaces(net)[1]!;
  const counter = counterPlaces(net)[0]!;
  const good = {
    title: 'Rainbow post',
    idea: 'The parcels are rainbows.',
    setting: 'A post office for fairy tales',
    entity: { singular: 'Rainbow', plural: 'Rainbows', emoji: '🌈' },
    stages: [{ place: stage, sprite: 'document', tint: 'ok' }],
    counters: [{ place: counter, style: 'pictogram', per: 4, emoji: '⭐', history: true }],
    layout: 'top-to-bottom',
    equipment: 'zones',
  };

  it('asks with the net, the names of symbols and the additions, without positions', () => {
    const prompt = buildConceptPrompt({ net, additions: 'Unicorns please', setting: 'Fairy tale' });
    expect(prompt.user).toContain('"id":"p_in"');
    expect(prompt.user).not.toContain('"positions"');
    expect(prompt.user).toContain('Unicorns please');
    expect(prompt.user).toContain('Fairy tale');
    expect(prompt.system).toContain('at most 3 different concepts');
    expect(prompt.user).toContain('"maxItems":3');
  });

  it('turns a good answer into a filled form', () => {
    const { concepts, notes } = readConcepts(net, { concepts: [good] });
    expect(notes).toEqual([]);
    expect(concepts).toHaveLength(1);
    const c = concepts[0]!;
    expect(c.title).toBe('Rainbow post');
    expect(c.dropped).toEqual([]);
    expect(c.choices.entity).toEqual({ singular: 'Rainbow', plural: 'Rainbows', emoji: '🌈' });
    expect(c.choices.stages[stage]).toEqual({ sprite: 'document', tint: 'ok' });
    expect(c.choices.counters[counter]).toMatchObject({
      style: 'pictogram',
      per: 4,
      emoji: '⭐',
      history: true,
    });
    expect(c.choices.layout).toBe('top-to-bottom');
    expect(c.choices.equipment).toBe('zones');
    expect(c.choices.setting).toBe('A post office for fairy tales');
  });

  it('drops invalid parts, notes them on the card, and shows at most three', () => {
    const bad = {
      title: 'Broken',
      idea: 'Many mistakes',
      entity: { singular: 'A', plural: 'As', emoji: 'ab' },
      stages: [
        { place: 'nope', emoji: '🌈' },
        { place: stage, sprite: 'unicorn' },
        { place: stage, emoji: '🌈', tint: 'ok' },
      ],
      counters: [
        { place: counter, style: 'fill', max: -5, icon: 'banana' },
        { place: 'nope', style: 'number' },
        { place: counter, style: 'gauge' },
      ],
      layout: 'diagonal',
    };
    const { concepts } = readConcepts(net, {
      concepts: [bad, { idea: 'no title' }, good],
    });
    expect(concepts.map((c) => c.title)).toEqual(['Broken', 'Rainbow post']);
    const dropped = concepts[0]!.dropped.join('\n');
    expect(dropped).toContain('entity symbol');
    expect(dropped).toContain('"nope"');
    expect(dropped).toContain('unknown sprite');
    expect(dropped).toContain('unknown style');
    expect(dropped).toContain('banana');
    // The valid rest is kept: the form keeps its defaults where the answer was invalid.
    const defaults = defaultChoices(net, null);
    expect(concepts[0]!.choices.layout).toBe('editor');
    expect(concepts[0]!.choices.entity).toEqual(defaults.entity);
    expect(concepts[0]!.choices.counters[counter]!.max).toBe(defaults.counters[counter]!.max);
    const all = readConcepts(net, { concepts: [good, good, good, good] });
    expect(all.concepts).toHaveLength(3);
    expect(all.notes.join('\n')).toContain('first 3');
  });

  it('says so when the answer holds no concept', () => {
    expect(readConcepts(net, { nothing: true }).notes).toHaveLength(1);
    expect(readConcepts(net, { concepts: [] }).notes).toHaveLength(1);
    expect(readConcepts(net, undefined).concepts).toEqual([]);
  });

  it('are asked for with one request', async () => {
    const provider = createFakeProvider([{ json: { concepts: [good] } }]);
    const result = await suggestConcepts(provider, { net, additions: 'x' });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.schema).toBeDefined();
    expect(result.concepts).toHaveLength(1);
    expect(result.model).toBe('fake-model');
    expect(result.prompt.user).toContain('## Net');
  });
});

describe('an unused view', () => {
  it('keeps the view type honest', () => {
    const typed: DomainView = view;
    expect(typed.schemaVersion).toBe(1);
  });
});
