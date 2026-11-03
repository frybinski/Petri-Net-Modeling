import { placeRoles, type PetriNet } from '@pnm/core';
import {
  DISPLAY_ICONS,
  EQUIPMENT_CHOICES,
  LAYOUT_CHOICES,
  QUANTITY_ICONS,
  SPRITES,
  TINTS,
  counterPlaces,
  defaultChoices,
  emojiProblem,
  iconAllowed,
  stagePlaces,
  type CounterChoice,
  type DisplayIcon,
  type ViewChoices,
} from '@pnm/domain';
import { compactNet } from './compact-net';
import { compactJson } from './format';
import type { ChatProvider } from './provider';
import type { Prompt } from './prompt';

/**
 * Concepts (N4): one short request that asks the model for up to three ideas how the picture of
 * a net could look. Each concept is a filled-in form of the guided way. Whatever is wrong in an
 * answer is dropped before a card is shown, and noted on the card.
 */

export const MAX_CONCEPTS = 3;

/** A suggestion that fills the form of the guided way. */
export interface Concept {
  title: string;
  /** One sentence on the idea. */
  idea: string;
  /** The form as this concept fills it (what the answer left out stays as it was). */
  choices: ViewChoices;
  /** What of the answer was invalid and left out. */
  dropped: string[];
}

export interface ConceptResult {
  concepts: Concept[];
  /** Remarks about the answer as a whole, for example that it held no usable concept. */
  notes: string[];
  model: string;
  prompt: Prompt;
}

export interface ConceptInput {
  net: PetriNet;
  /** The additions of the form, if the person wrote some; they steer the ideas. */
  additions?: string;
  /** The setting of the form. */
  setting?: string;
}

/** The JSON Schema of the answer to the request for concepts. */
export function conceptSchema(): Record<string, unknown> {
  const symbol = {
    sprite: { type: 'string', enum: [...SPRITES] },
    tint: { type: 'string', enum: [...TINTS] },
    emoji: { type: 'string' },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['concepts'],
    properties: {
      concepts: {
        type: 'array',
        maxItems: MAX_CONCEPTS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'idea', 'setting', 'entity'],
          properties: {
            title: { type: 'string' },
            idea: { type: 'string' },
            setting: { type: 'string' },
            viewName: { type: 'string' },
            entity: {
              type: 'object',
              additionalProperties: false,
              required: ['singular', 'plural'],
              properties: {
                singular: { type: 'string' },
                plural: { type: 'string' },
                sprite: symbol.sprite,
                emoji: symbol.emoji,
              },
            },
            stages: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['place'],
                properties: { place: { type: 'string' }, ...symbol },
              },
            },
            counters: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['place', 'style'],
                properties: {
                  place: { type: 'string' },
                  style: { type: 'string', enum: ['number', 'fill', 'pictogram'] },
                  max: { type: 'number' },
                  per: { type: 'number' },
                  icon: { type: 'string', enum: [...DISPLAY_ICONS] },
                  emoji: { type: 'string' },
                  history: { type: 'boolean' },
                },
              },
            },
            layout: { type: 'string', enum: [...LAYOUT_CHOICES] },
            equipment: { type: 'string', enum: [...EQUIPMENT_CHOICES] },
          },
        },
      },
    },
  };
}

const CONCEPT_SYSTEM = `You help a user decide how the picture of a Petri net could look. The net describes a process; its picture shows the cases of the process as small symbols that move through it. You do not draw anything and you do not write a domain view. You propose at most ${MAX_CONCEPTS} different concepts, each one a complete answer to the questions of a form.

Answer with exactly one JSON object and nothing else: no explanation, no Markdown. It has the key "concepts", an array of at most ${MAX_CONCEPTS} objects. Each concept has:
- "title": two to five words; "idea": one sentence on what makes this concept different from the others.
- "setting": the place and the theme of the process in a few words (for example "Hospital outpatient clinic"); optionally "viewName".
- "entity": "singular", "plural" and the symbol of the cases, either "sprite" (one of ${SPRITES.join(', ')}) or "emoji" (exactly one emoji such as "📚"). A built-in sprite is better where one fits; an emoji where none does.
- "stages": optional; one entry for each place that holds cases (role "source" or "case") whose cases should look different from the entity: {"place": "<id>", then either "sprite" with an optional "tint" (one of ${TINTS.join(', ')}) or "emoji"}. Use it where the process gives a reason, for example a case that changes while it is worked on.
- "counters": optional; one entry for each place of role "quantity" or "sink" that should show more than its number: {"place": "<id>", "style": "number", "fill" or "pictogram", then "max" (the count at which a container is full) for "fill" or "per" (how many tokens one symbol stands for; choose it so that about 10 to 20 symbols appear) for "pictogram", a symbol ("icon" or "emoji", never both) and optionally "history": true}. The symbols of amounts are ${QUANTITY_ICONS.join(', ')}; a sink of cases may also use a sprite or an emoji.
- "layout": ${LAYOUT_CHOICES.map((l) => `"${l}"`).join(', ')}; "equipment": ${EQUIPMENT_CHOICES.map((e) => `"${e}"`).join(', ')} (plain, with zones and labels, or as a floor plan with rooms).
Use only the ids of the net, spelled exactly. Make the concepts differ in their setting and symbols, not only in wording. Write in the language of the names in the net.`;

/** The request for concepts. */
export function buildConceptPrompt(input: ConceptInput): Prompt {
  const { net } = input;
  const user = [
    '## Net',
    compactJson(compactNet(net, { positions: false }), 2),
    '',
    ...(input.setting !== undefined && input.setting.trim() !== ''
      ? ['## Setting wished for', input.setting.trim(), '']
      : []),
    ...(input.additions !== undefined && input.additions.trim() !== ''
      ? ['## Additions of the user', input.additions.trim(), '']
      : []),
    '## JSON Schema of your answer',
    JSON.stringify(conceptSchema()),
    '',
    '## Task',
    `Propose up to ${MAX_CONCEPTS} concepts for the net "${net.name}". Answer with the JSON object only.`,
  ].join('\n');
  return { system: CONCEPT_SYSTEM, user };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads one concept; `null` if it has no title or idea. What is invalid inside is dropped. */
function readConcept(net: PetriNet, raw: unknown, index: number): Concept | null {
  if (!isRecord(raw)) return null;
  const title = text(raw['title'], 60);
  const idea = text(raw['idea'], 240);
  if (title === null) return null;
  const dropped: string[] = [];
  const roles = placeRoles(net);
  const base = defaultChoices(net, null);
  const choices: ViewChoices = {
    ...base,
    stages: { ...base.stages },
    counters: { ...base.counters },
  };

  const setting = text(raw['setting'], 120);
  if (setting !== null) choices.setting = setting;
  const viewName = text(raw['viewName'], 80);
  if (viewName !== null) choices.viewName = viewName;

  const entity = isRecord(raw['entity']) ? raw['entity'] : null;
  if (entity === null) dropped.push('entity: missing');
  else {
    const singular = text(entity['singular'], 40);
    const plural = text(entity['plural'], 40);
    if (singular !== null && plural !== null) {
      const emoji = entity['emoji'];
      const sprite = entity['sprite'];
      if (typeof emoji === 'string' && sprite === undefined) {
        const problem = emojiProblem(emoji);
        if (problem === null) choices.entity = { singular, plural, emoji };
        else dropped.push(`entity symbol: ${problem}`);
      } else if (
        typeof sprite === 'string' &&
        emoji === undefined &&
        (SPRITES as readonly string[]).includes(sprite)
      ) {
        choices.entity = { singular, plural, sprite: sprite as (typeof SPRITES)[number] };
      } else dropped.push('entity symbol: write exactly one of "sprite" and "emoji"');
    } else dropped.push('entity: the names are missing');
  }

  const stageIds = new Set(stagePlaces(net));
  const stages = Array.isArray(raw['stages']) ? raw['stages'] : [];
  for (const item of stages) {
    if (!isRecord(item) || typeof item['place'] !== 'string') {
      dropped.push('a stage without a place');
      continue;
    }
    const id = item['place'];
    if (!stageIds.has(id)) {
      dropped.push(`stage "${id}": not a place that holds cases`);
      continue;
    }
    const { sprite, emoji, tint } = item;
    if (typeof emoji === 'string' && sprite === undefined && tint === undefined) {
      const problem = emojiProblem(emoji);
      if (problem === null) choices.stages[id] = { emoji };
      else dropped.push(`stage "${id}": ${problem}`);
    } else if (typeof sprite === 'string' && emoji === undefined) {
      if (!(SPRITES as readonly string[]).includes(sprite)) {
        dropped.push(`stage "${id}": unknown sprite "${sprite}"`);
      } else if (tint !== undefined && !(TINTS as readonly string[]).includes(String(tint))) {
        dropped.push(`stage "${id}": unknown tint "${String(tint)}"`);
      } else {
        choices.stages[id] = {
          sprite: sprite as (typeof SPRITES)[number],
          ...(tint !== undefined && { tint: tint as (typeof TINTS)[number] }),
        };
      }
    } else dropped.push(`stage "${id}": write a sprite (with a tint) or an emoji`);
  }

  const counterIds = new Set(counterPlaces(net));
  const counters = Array.isArray(raw['counters']) ? raw['counters'] : [];
  for (const item of counters) {
    if (!isRecord(item) || typeof item['place'] !== 'string') {
      dropped.push('a counter without a place');
      continue;
    }
    const id = item['place'];
    if (!counterIds.has(id)) {
      dropped.push(`counter "${id}": not a place of an amount or a sink`);
      continue;
    }
    const style = item['style'];
    if (style !== 'number' && style !== 'fill' && style !== 'pictogram') {
      dropped.push(`counter "${id}": unknown style`);
      continue;
    }
    const fallback = choices.counters[id]!;
    const choice: CounterChoice = {
      ...fallback,
      style,
      max: finitePositive(item['max']) ?? fallback.max,
      per: finitePositive(item['per']) ?? fallback.per,
      history: item['history'] === true,
    };
    delete choice.icon;
    delete choice.emoji;
    const role = roles.get(id) ?? 'case';
    const emoji = item['emoji'];
    const icon = item['icon'];
    if (typeof emoji === 'string' && icon === undefined) {
      const problem = emojiProblem(emoji);
      if (problem === null) choice.emoji = emoji;
      else dropped.push(`counter "${id}": ${problem}`);
    } else if (typeof icon === 'string' && emoji === undefined) {
      if (
        (DISPLAY_ICONS as readonly string[]).includes(icon) &&
        iconAllowed(role, icon as DisplayIcon)
      ) {
        choice.icon = icon as DisplayIcon;
      } else dropped.push(`counter "${id}": the symbol "${icon}" does not fit a ${role} place`);
    } else if (icon !== undefined || emoji !== undefined) {
      dropped.push(`counter "${id}": write either an icon or an emoji`);
    }
    choices.counters[id] = choice;
  }

  if ((LAYOUT_CHOICES as readonly string[]).includes(String(raw['layout']))) {
    choices.layout = raw['layout'] as ViewChoices['layout'];
  }
  if ((EQUIPMENT_CHOICES as readonly string[]).includes(String(raw['equipment']))) {
    choices.equipment = raw['equipment'] as ViewChoices['equipment'];
  }
  return { title, idea: idea ?? `Concept ${index + 1}`, choices, dropped };
}

/**
 * Reads the answer of the model: at most three concepts, with what is invalid left out. A concept
 * without a title is skipped.
 */
export function readConcepts(
  net: PetriNet,
  json: unknown,
): { concepts: Concept[]; notes: string[] } {
  const list = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json['concepts'])
      ? json['concepts']
      : null;
  if (list === null) return { concepts: [], notes: ['The answer holds no list of concepts.'] };
  const concepts: Concept[] = [];
  const notes: string[] = [];
  list.slice(0, MAX_CONCEPTS).forEach((raw, index) => {
    const concept = readConcept(net, raw, index);
    if (concept) concepts.push(concept);
    else notes.push(`Concept ${index + 1} was skipped: it has no title.`);
  });
  if (list.length > MAX_CONCEPTS) notes.push(`Only the first ${MAX_CONCEPTS} concepts are shown.`);
  if (concepts.length === 0 && notes.length === 0) notes.push('The answer holds no concept.');
  return { concepts, notes };
}

/** Asks the model for concepts. Throws an `LlmError` if the provider fails. */
export async function suggestConcepts(
  provider: ChatProvider,
  input: ConceptInput,
  options: { signal?: AbortSignal } = {},
): Promise<ConceptResult> {
  const prompt = buildConceptPrompt(input);
  const answer = await provider.chat({
    system: prompt.system,
    user: prompt.user,
    schema: conceptSchema(),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { ...readConcepts(input.net, answer.json), model: answer.model, prompt };
}
