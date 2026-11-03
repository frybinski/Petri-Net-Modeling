import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import {
  DISPLAY_ICONS,
  EQUIPMENT_CHOICES,
  LAYOUT_CHOICES,
  QUANTITY_ICONS,
  SPRITES,
  TINTS,
  defaultChoices,
  type DomainView,
} from '@pnm/domain';
import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  buildConceptPrompt,
  buildPrompt,
  buildRepairPrompt,
  compactNet,
  conceptSchema,
  repairSystemText,
  systemText,
} from '../src';

/**
 * The fixed texts of the prompt must not contain the solution of an example net: not its theme,
 * its names, its labels, and not an English rendering of them. The examples would be no examples
 * of the format any more, and an evaluation would measure what the prompt tells, not the model.
 */

const examplesDir = join(import.meta.dirname, '..', '..', '..', 'examples');

interface ExampleWithView {
  id: string;
  net: PetriNet;
  view: DomainView;
}

/** Every net in `examples/` that has a domain view; a new one is picked up by itself. */
function examplesWithView(): ExampleWithView[] {
  const found: ExampleWithView[] = [];
  for (const file of readdirSync(examplesDir).sort()) {
    if (!file.endsWith('.pn.json')) continue;
    const net = parseNetText(readFileSync(join(examplesDir, file), 'utf8'));
    if (net.domainView) {
      found.push({ id: file.replace(/\.pn\.json$/, ''), net, view: net.domainView as DomainView });
    }
  }
  return found;
}

/**
 * English renderings of what the German examples contain, kept by hand. Words that every prompt
 * about views needs (queue, station, dock, door, hall in the introduction) are not listed.
 */
const ENGLISH: Record<string, string[]> = {
  'parcel-center': [
    'parcel sorting',
    'parcel center',
    'sorting center',
    'sorting centre',
    'hall 2',
    'scanner',
    'sorter',
    'express lane',
    'loading team',
  ],
  'smart-office': [
    'smart office',
    'meeting room',
    'meeting rooms',
    'open-plan office',
    'turnstile',
    'coffee',
    'coffee machine',
    'desks',
    'foyer',
  ],
  'bike-frames': [
    'bicycle frame',
    'bicycle frames',
    'frame production',
    'frame manufacturing',
    'tube',
    'tubes',
    'coated',
    'coating',
    'powder coating',
    'weld',
    'welding',
    'saw',
    'rework',
    'steel',
    'scrap',
    // The counters of the example: CO2e, residual waste and shipped frames as pictograms.
    'emission',
    'emissions',
    'residual waste',
    'shipped goods',
  ],
};

/** Strings of a view that a person wrote: theme, names, labels, texts. */
function termsOf(example: ExampleWithView): string[] {
  const { net, view } = example;
  const terms: string[] = [view.meta.theme, view.meta.viewName];
  terms.push(view.meta.entity.singular, view.meta.entity.plural);
  for (const item of view.decor ?? []) {
    if ('label' in item && typeof item.label === 'string') terms.push(item.label);
    if ('text' in item && typeof item.text === 'string') terms.push(item.text);
  }
  for (const entry of [...Object.values(view.places), ...Object.values(view.transitions)]) {
    const label = (entry as { label?: unknown }).label;
    if (typeof label === 'string') terms.push(label);
  }
  terms.push(...net.places.map((p) => p.name), ...net.transitions.map((t) => t.name));
  return terms;
}

/** Split a term into the phrase itself and, for a single word, only if it is long enough. */
function wanted(term: string): boolean {
  const trimmed = term.trim();
  if (trimmed === '') return false;
  const isSingleWord = !/\s/.test(trimmed);
  return !isSingleWord || trimmed.length >= 4;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole words, any case. */
function contains(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Removes the lists of names that the prompt must give: sprites, icons and tints, written the way
 * the prompt writes them (a comma separated list) and as strings of the schema. It uses the
 * constants of `@pnm/domain`, as the prompt does.
 */
function withoutEnumerations(text: string): string {
  let result = text;
  for (const list of [
    SPRITES,
    QUANTITY_ICONS,
    TINTS,
    DISPLAY_ICONS,
    LAYOUT_CHOICES,
    EQUIPMENT_CHOICES,
  ]) {
    result = result.split(list.join(', ')).join(' ');
    result = result.split(list.map((name) => `"${name}"`).join(', ')).join(' ');
    for (const name of list) result = result.split(`"${name}"`).join(' ');
  }
  return result;
}

/** The text without the sections that hold the net and the worked examples. */
function fixedFrame(user: string): string {
  const sections = user.split(/^(?=## )/m);
  return sections
    .filter((s) => !s.startsWith('## Net to map') && !s.startsWith('## Worked examples'))
    .join('');
}

const canvas = { width: 1200, height: 640 };
const probe: PetriNet = {
  ...examplesWithView()[0]!.net,
  name: 'Probe',
  places: [],
  transitions: [],
  arcs: [],
  marking: {},
};
delete (probe as { domainView?: unknown }).domainView;

function checkedTexts(): Array<{ what: string; text: string }> {
  const first = buildPrompt({
    net: probe,
    description: 'A probe.',
    canvas,
    examples: [],
    schema: answerSchema(),
  });
  const repair = buildRepairPrompt({
    previous: {},
    diagnostics: [],
    net: compactNet(probe),
    canvas,
  });
  // The guided way (N4): the section of the binding choices and the request for concepts.
  const guided = buildPrompt({
    net: probe,
    description: 'A probe.',
    canvas,
    examples: [],
    schema: answerSchema(),
    choices: defaultChoices(probe, null),
  });
  const concepts = buildConceptPrompt({ net: probe });
  return [
    { what: 'system text', text: systemText() },
    { what: 'frame of the first request with choices', text: fixedFrame(guided.user) },
    { what: 'system text of the concept request', text: concepts.system },
    { what: 'frame of the concept request', text: concepts.user },
    { what: 'JSON Schema of the concepts', text: JSON.stringify(conceptSchema()) },
    { what: 'repair system text', text: repairSystemText() },
    { what: 'frame of the first request', text: fixedFrame(first.user) },
    { what: 'frame of the repair request', text: repair.user },
  ].map((item) => ({ ...item, text: withoutEnumerations(item.text) }));
}

describe('the fixed texts of the prompt do not give away an example', () => {
  const examples = examplesWithView();

  it('finds the example nets that have a domain view', () => {
    expect(examples.map((e) => e.id)).toEqual(
      expect.arrayContaining(['bike-frames', 'parcel-center', 'smart-office']),
    );
    for (const example of examples) {
      expect(
        ENGLISH[example.id],
        `add English equivalents for ${example.id} to this test`,
      ).toBeDefined();
    }
  });

  it('removes the lists of sprites, icons and tints by their constants, and only those', () => {
    const stripped = withoutEnumerations(`one of ${SPRITES.join(', ')} and "frame" but not frame`);
    expect(stripped).not.toContain('bicycle');
    expect(stripped).not.toContain('"frame"');
    expect(stripped).toContain('but not frame');
  });

  it('would have caught the texts of version 1 (1.4.0)', () => {
    const version1 = `(for example "Parcel sorting center"), "viewName" (for example "Hall 2") an order as "document", cut tubes as "bars", a raw frame as "frame" with tint "neutral", a coated one as "frame" with tint "accent", the shipped item as "parcel".`;
    expect(contains(version1, 'parcel sorting')).toBe(true);
    expect(contains(version1, 'hall 2')).toBe(true);
    expect(contains(version1, 'tubes')).toBe(true);
    expect(contains(version1, 'coated')).toBe(true);
  });

  it('matches whole words in any case only', () => {
    expect(contains('The Hall 2 is big', 'hall 2')).toBe(true);
    expect(contains('a tube.', 'tube')).toBe(true);
    expect(contains('a tubex', 'tube')).toBe(false);
    expect(contains('subtube', 'tube')).toBe(false);
  });

  for (const example of examplesWithView()) {
    it(`has nothing of ${example.id} in the system text or the frames`, () => {
      const terms = [...new Set([...termsOf(example), ...(ENGLISH[example.id] ?? [])])].filter(
        (term) => (ENGLISH[example.id] ?? []).includes(term) || wanted(term),
      );
      expect(terms.length).toBeGreaterThan(10);
      const hits: string[] = [];
      for (const { what, text } of checkedTexts()) {
        for (const term of terms) {
          if (contains(text, term)) hits.push(`${what}: "${term}"`);
        }
      }
      expect(hits).toEqual([]);
    });
  }
});
