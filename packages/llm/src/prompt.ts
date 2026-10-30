import type { PetriNet } from '@pnm/core';
import {
  MIN_QUEUE_LENGTH,
  SPRITES,
  domainViewJsonSchema,
  type DomainDiagnostic,
  type DomainView,
} from '@pnm/domain';
import { compactNet, type CompactNet } from './compact-net';
import { compactJson } from './format';

export interface Canvas {
  width: number;
  height: number;
}

/** A net with a view that is known to be good, shown to the model as a worked example. */
export interface PromptExample {
  net: PetriNet;
  view: DomainView;
}

export interface PromptInput {
  net: PetriNet;
  description: string;
  canvas: Canvas;
  examples: PromptExample[];
  /** JSON Schema of the answer; see `answerSchema`. */
  schema: unknown;
}

export interface Prompt {
  system: string;
  user: string;
}

/** Decor entries kept in an example. */
export const EXAMPLE_DECOR_LIMIT = 8;

/**
 * The JSON Schema of what the model writes: a domain view without `netHash` and `provenance`,
 * which the tool sets.
 */
export function answerSchema(): Record<string, unknown> {
  const schema = structuredClone(domainViewJsonSchema());
  const properties = schema['properties'] as Record<string, unknown> | undefined;
  if (properties) {
    delete properties['netHash'];
    delete properties['provenance'];
  }
  const required = schema['required'];
  if (Array.isArray(required)) {
    schema['required'] = required.filter((key) => key !== 'netHash' && key !== 'provenance');
  }
  return schema;
}

const ROLE_AND_RULES = `You map a Petri net onto a domain view: a picture of the real place where the process happens (a hall, a floor plan, a workshop). You decide only WHERE things are drawn and WHAT they are drawn as. You never change what the net does: the net alone defines the behaviour, and a program checks your answer against the net.

Answer with exactly one JSON object and nothing else: no explanation, no Markdown. The object has the keys "schemaVersion" (always 1), "meta", "places", "transitions" and, optionally, "arcs" and "decor". Do not write "netHash" or "provenance"; the tool adds them.

Rules. A program checks every one of them and reports what is broken:
1. Every place and every transition of the net gets exactly one entry, in "places" and "transitions", keyed by its id spelled exactly as in the net. Do not invent ids.
2. The kind of a place follows its role in the net:
   - role "source" (no transition puts tokens on it): "source" (a box where cases appear) or a belt-like kind ("queue", "conveyor", "buffer"), or "hidden".
   - role "case" (a queue or a stage of work in progress): "queue", "conveyor" or "buffer"; "hidden" only if the place has no meaning in the domain. Never "slots".
   - role "resource" (workers, machines, rooms that are taken and given back): "slots" or "pool". "slots" needs "of": the id of a transition that the place both feeds and is fed by (see "loopsWith"); the resource units then stand in the slots of that transition. A resource place that does not belong to a single transition is a "pool" at a point.
   - role "sink" (cases leave here): "sink" (a box) or "hidden".
   - role "quantity" (its tokens count an amount such as kilograms, litres or euros and belong to no case): a counter, that is "pool" (a point), "source" or "sink" (a box), labelled with the unit, or "hidden" with a reason if it is only an auxiliary place; never a belt-like kind or "slots".
3. A transition without input place (role "source", arrivals) must be a "door" or a "dock" (a point) or "hidden". Other transitions are "station", "machine" or "gate" (a box, with "slots" for the resource units working there), "area" or "rooms" (a box, "slots" required, optional "rooms"), or "waypoint" (a point where cases pass without waiting). "hidden" needs a "reason".
4. A transition that a "slots" place refers to needs at least as many slot points as the resource place has tokens at the start. Slot points lie inside the box of the transition, at least 24 px apart.
5. Geometry is in canvas pixels, origin at the top left, y grows downwards. Every point and rectangle lies completely inside the canvas. A rectangle is [x, y, width, height] with positive width and height. A point is [x, y]. A path has at least two points of different position, in the direction in which cases move. Paths of queues, conveyors and buffers should be at least ${MIN_QUEUE_LENGTH} px long (they hold about ten tokens).
6. A view describes only geometry and labels. Never write durations, weights, rates, probabilities, priorities, guards, conditions or capacities; the net has them.
7. "meta" has "theme" (the setting, for example "Parcel sorting center"), "viewName" (for example "Hall 2"), "entity" with "singular", "plural" and "sprite" (one of ${SPRITES.join(', ')}), the canvas size exactly as given, and optionally "metersPerPixel".
8. "arcs" is optional: keys are "sourceId>targetId", values {"path": [[x, y], [x, y]]}. A straight path from the border of one element to the border of the other is fine. Arcs you leave out are drawn automatically.
9. "decor" is optional scenery that gives context: "room" or "zone" ({"rect", "label"?}), "wall" ({"segs": [[x1, y1, x2, y2], ...], "width"?}), "label" ({"pos", "text"}), "furniture" ({"rect"}) and "scale" ({"pos", "px", "label"}). Use at most ten entries.

Layout. Follow the flow of the process, usually from left to right. The positions of the net in the editor (scaled to 0..1) show how the author arranged it; use them as a hint, but use the whole canvas. Put every transition next to the places it connects, keep at least 40 px between boxes, and make boxes large enough for their labels. Labels are short and use the language of the names in the net.`;

const REPAIR_ADDENDUM = `

In this request you repair an answer. You get the findings of the checking program and the entries they are about. Fix exactly those findings and change nothing else.`;

/** The system text of the first request. */
export function systemText(): string {
  return ROLE_AND_RULES;
}

/** The system text of a repair request. */
export function repairSystemText(): string {
  return ROLE_AND_RULES + REPAIR_ADDENDUM;
}

/** An example view as shown to the model: no provenance, no hash, no arcs, little decor. */
export function shortenExample(view: DomainView): Omit<DomainView, 'netHash' | 'provenance'> {
  const { netHash: _hash, provenance: _provenance, arcs: _arcs, decor, ...rest } = view;
  return { ...rest, ...(decor ? { decor: decor.slice(0, EXAMPLE_DECOR_LIMIT) } : {}) };
}

function exampleText(example: PromptExample, index: number): string {
  return [
    `### Example ${index + 1}: ${example.net.name}`,
    'Net:',
    compactJson(compactNet(example.net), 2),
    'Domain view (arcs left out here; they are optional):',
    compactJson(shortenExample(example.view), 2),
  ].join('\n');
}

/** The first request: the domain, the net, the schema and two worked examples. */
export function buildPrompt(input: PromptInput): Prompt {
  const { net, description, canvas, examples, schema } = input;
  const text = description.trim() === '' ? `A process called "${net.name}".` : description.trim();
  const user = [
    '## Domain',
    text,
    '',
    '## Canvas',
    `The canvas is ${canvas.width} px wide and ${canvas.height} px high. Write exactly these numbers to "meta.canvas".`,
    '',
    '## Net to map',
    compactJson(compactNet(net), 2),
    '',
    '## JSON Schema of your answer',
    JSON.stringify(schema),
    '',
    '## Worked examples',
    'These show the format and the level of detail. Do not copy their geometry.',
    '',
    ...examples.flatMap((example, i) => [exampleText(example, i), '']),
    '## Task',
    `Write the domain view for the net "${net.name}" above. Answer with the JSON object only.`,
  ].join('\n');
  return { system: systemText(), user };
}

/** The rules that the findings belong to, in a short form for the model. */
const RULE_HINTS: Record<string, string> = {
  V1: 'does not match the schema',
  V2: 'names something that is not in the net',
  V3: 'an element has no entry',
  V4: 'the kind does not fit the role',
  V5: 'geometry (outside the canvas, empty, too few points)',
  V6: 'too little room',
  V7: 'stale hash',
  V8: 'hidden place that holds cases',
  V9: 'a quantity place is drawn as something other than a counter',
};

export interface RepairInput {
  /** What the model wrote before; may be incomplete or wrong. */
  previous: {
    meta?: unknown;
    places?: Record<string, unknown>;
    transitions?: Record<string, unknown>;
    arcs?: Record<string, unknown>;
    decor?: unknown[];
  };
  diagnostics: DomainDiagnostic[];
  net: CompactNet;
  canvas: Canvas;
}

/** At most this many findings are sent back. */
export const MAX_FINDINGS = 40;

/** The keys of the parts of `previous` that a path points into. */
function affectedEntries(
  path: string,
  previous: RepairInput['previous'],
): { section: 'places' | 'transitions' | 'arcs'; key: string } | { decor: number } | 'meta' | null {
  if (path === 'meta' || path.startsWith('meta.')) return 'meta';
  const decor = /^decor\[(\d+)\]/.exec(path);
  if (decor) return { decor: Number(decor[1]) };
  for (const section of ['places', 'transitions', 'arcs'] as const) {
    const entries = previous[section];
    if (!entries) continue;
    const prefix = `${section}.`;
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const keys = Object.keys(entries).sort((a, b) => b.length - a.length);
    const key = keys.find(
      (k) => rest === k || rest.startsWith(`${k}.`) || rest.startsWith(`${k}[`),
    );
    if (key !== undefined) return { section, key };
  }
  return null;
}

/** The request that asks for a correction of the findings. */
export function buildRepairPrompt(input: RepairInput): Prompt {
  const { previous, diagnostics, net, canvas } = input;
  const shown = diagnostics.slice(0, MAX_FINDINGS);
  const findings = shown.map(
    (d) =>
      `- ${d.rule} ${d.severity} at ${d.path}: ${d.message}${RULE_HINTS[d.rule] ? ` (${RULE_HINTS[d.rule]})` : ''}`,
  );
  if (diagnostics.length > shown.length) {
    findings.push(`- ... and ${diagnostics.length - shown.length} more`);
  }

  const old: Record<string, unknown> = {};
  const places: Record<string, unknown> = {};
  const transitions: Record<string, unknown> = {};
  const arcs: Record<string, unknown> = {};
  const decor: Record<string, unknown> = {};
  for (const d of shown) {
    const hit = affectedEntries(d.path, previous);
    if (hit === 'meta') {
      if (previous.meta !== undefined) old['meta'] = previous.meta;
    } else if (hit && 'decor' in hit) {
      const item = previous.decor?.[hit.decor];
      if (item !== undefined) decor[`decor[${hit.decor}]`] = item;
    } else if (hit) {
      const target =
        hit.section === 'places' ? places : hit.section === 'transitions' ? transitions : arcs;
      const entry = previous[hit.section]?.[hit.key];
      if (entry !== undefined) target[hit.key] = entry;
    }
  }
  if (Object.keys(places).length > 0) old['places'] = places;
  if (Object.keys(transitions).length > 0) old['transitions'] = transitions;
  if (Object.keys(arcs).length > 0) old['arcs'] = arcs;
  if (Object.keys(decor).length > 0) old['decor'] = decor;

  const user = [
    '## Net',
    compactJson(net, 2),
    '',
    '## Canvas',
    `${canvas.width} px wide, ${canvas.height} px high.`,
    '',
    '## Findings of the checking program',
    ...findings,
    '',
    '## Your entries that the findings are about',
    Object.keys(old).length > 0
      ? compactJson(old, 2)
      : '(none: the entries are missing or the answer was unusable)',
    '',
    '## Task',
    'Answer with a JSON object that contains only the corrected entries, in the shape',
    '{ "places": { "<id>": { ... } }, "transitions": { "<id>": { ... } }, "arcs": { "<key>": { ... } }, "decor": [ ... ] }',
    'Leave out every section that you do not change. An entry you write replaces the old entry completely, so write it in full. If you change "decor", write the complete corrected list. If "meta" is wrong, include a complete "meta". Entries that are missing must be added. Answer with the JSON object only.',
  ].join('\n');
  return { system: repairSystemText(), user };
}
