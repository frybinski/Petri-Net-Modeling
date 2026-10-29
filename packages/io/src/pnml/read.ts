import {
  NetFormatError,
  isToken,
  parseNet,
  validate,
  type Annotation,
  type Diagnostic,
  type Arc,
  type Id,
  type Marking,
  type PetriNet,
  type Place,
  type Position,
  type Profile,
  type SimulationSettings,
  type Timing,
  type Token,
  type Transition,
} from '@pnm/core';
import {
  XmlParseError,
  childElements,
  firstChild,
  parseXml,
  textContent,
  type XmlElement,
} from '../xml';
import { PNM_TOOL, PNM_TOOL_VERSION } from './constants';

export interface PnmlReadOptions {
  /**
   * `keep` (default) uses the positions of the file and lays the net out only if positions are
   * missing; `auto` always lays the net out, ignoring the positions of the file.
   */
  layout?: 'keep' | 'auto';
}

export interface PnmlParse {
  net: PetriNet;
  /** Things that were not understood, were dropped or changed, and findings of `validate`. */
  warnings: string[];
  /** The part of `warnings` that is about the file, without the findings of `validate`. */
  importWarnings: string[];
  /** The findings of `validate` on the net that was read (already in `warnings`). */
  diagnostics: Diagnostic[];
  /** Some nodes have no position, so the positions of `net` are placeholders. */
  needsLayout: boolean;
}

export interface PnmlImport {
  net: PetriNet;
  /** Everything worth telling the person: see `PnmlParse.warnings`. */
  warnings: string[];
  importWarnings: string[];
  diagnostics: Diagnostic[];
  /** The positions come from the automatic layout. */
  laidOut: boolean;
}

/** Raised when a file cannot be read as PNML at all. */
export class PnmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PnmlError';
  }
}

type Json = Record<string, unknown>;

/** Largest number of tokens that one place gets from an initial marking. */
const MAX_TOKENS_PER_PLACE = 10_000;
/** Distance between pages that are put next to each other. */
const PAGE_GAP = 120;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface RawNode {
  kind: 'place' | 'transition';
  xmlId: string | undefined;
  name: string | undefined;
  position: Position | undefined;
  count: number | undefined;
  payload: Json | undefined;
  silent: boolean;
  group: number;
}

interface RawArc {
  xmlId: string | undefined;
  source: string;
  target: string;
  weight: number | undefined;
  points: Position[];
  payload: Json | undefined;
  type: string | undefined;
  group: number;
}

/** The text of a `<name>`, `<text>`-style label, trimmed. */
function labelText(element: XmlElement | undefined): string | undefined {
  if (!element) return undefined;
  const text = firstChild(element, 'text');
  const raw = text
    ? textContent(text)
    : element.children.filter((child): child is string => typeof child === 'string').join('');
  return raw.trim();
}

function readPoint(element: XmlElement | undefined): Position | undefined {
  if (!element) return undefined;
  const x = Number(element.attributes['x']);
  const y = Number(element.attributes['y']);
  if (element.attributes['x'] === undefined || element.attributes['y'] === undefined) {
    return undefined;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function readPoints(graphics: XmlElement | undefined): Position[] {
  if (!graphics) return [];
  const out: Position[] = [];
  for (const position of childElements(graphics, 'position')) {
    const point = readPoint(position);
    if (point) out.push(point);
  }
  return out;
}

/**
 * Reads a count from the text of an initial marking or an inscription. Plain numbers are exact;
 * text that merely contains a number ("Default,2") is read leniently, a fraction or a negative
 * number is not a count.
 */
function countFromText(text: string): { value: number; exact: boolean } | undefined {
  const trimmed = text.trim();
  if (/^\+?\d+(\.0+)?$/.test(trimmed)) return { value: Math.floor(Number(trimmed)), exact: true };
  if (/^-\d|\d\.\d/.test(trimmed)) return undefined;
  const match = /\d+/.exec(trimmed);
  return match ? { value: Number(match[0]), exact: false } : undefined;
}

function isTiming(value: unknown): value is Timing {
  if (!isRecord(value)) return false;
  switch (value['kind']) {
    case 'fixed':
      return finite(value['value']) !== undefined;
    case 'uniform':
      return finite(value['min']) !== undefined && finite(value['max']) !== undefined;
    case 'exponential':
      return finite(value['mean']) !== undefined;
    default:
      return false;
  }
}

function timingOf(value: Json): Timing {
  switch (value['kind']) {
    case 'uniform':
      return { kind: 'uniform', min: Number(value['min']), max: Number(value['max']) };
    case 'exponential':
      return { kind: 'exponential', mean: Number(value['mean']) };
    default:
      return { kind: 'fixed', value: Number(value['value']) };
  }
}

/** Looks like a net type of place/transition nets, or of PNML's core model. */
function isPlainNetType(type: string): boolean {
  return /ptnet|pnmlcoremodel|epnml/i.test(type);
}

/**
 * Reads a PNML document into a net without laying it out. Nodes without position get the
 * placeholder (0, 0) and `needsLayout` is set; `fromPnml` lays them out.
 *
 * Throws `PnmlError` if the text is not well-formed XML or holds no net.
 */
export function parsePnml(xml: string): PnmlParse {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new PnmlError(`The file is not well-formed XML: ${error.message}`);
    }
    throw error;
  }

  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  let nets: XmlElement[];
  if (root.name === 'pnml') nets = childElements(root, 'net');
  else if (root.name === 'net') nets = [root];
  else throw new PnmlError(`This is not a PNML document (its root element is <${root.name}>).`);
  const netEl = nets[0];
  if (!netEl) throw new PnmlError('The PNML file contains no <net> element.');
  if (nets.length > 1) warn(`The file holds ${nets.length} nets; only the first one was read.`);

  const netType = netEl.attributes['type'];
  if (netType !== undefined && !isPlainNetType(netType)) {
    warn(
      `The net type "${netType}" is not a place/transition net; it was read as one, and ` +
        'inscriptions of other kinds were ignored.',
    );
  }

  /** Reads the `pnm` extension of an element; other tools' extensions are skipped. */
  const readPayload = (element: XmlElement, what: string): Json | undefined => {
    for (const spec of childElements(element, 'toolspecific')) {
      if (spec.attributes['tool'] !== PNM_TOOL) continue;
      const version = spec.attributes['version'];
      if (version !== undefined && version !== PNM_TOOL_VERSION) {
        warn(
          `The extension of ${what} has version ${version}; this tool reads version ` +
            `${PNM_TOOL_VERSION}, so some details may be missing.`,
        );
      }
      try {
        const parsed: unknown = JSON.parse(textContent(spec));
        if (isRecord(parsed)) return parsed;
      } catch {
        // Falls through to the warning.
      }
      warn(`The ${PNM_TOOL} extension of ${what} is not valid JSON and was ignored.`);
    }
    return undefined;
  };

  // Collect the objects of all pages, in document order.
  const nodes: RawNode[] = [];
  const arcs: RawArc[] = [];
  const references = new Map<string, string>();
  let groups = 0;
  let pageCount = 0;
  const finalMarkings = netEl.children.some(
    (child) => typeof child !== 'string' && child.name === 'finalmarkings',
  );

  const collect = (container: XmlElement, group: number): void => {
    for (const child of childElements(container)) {
      switch (child.name) {
        case 'place':
        case 'transition': {
          const graphics = firstChild(child, 'graphics');
          const marking = firstChild(child, 'initialMarking');
          let count: number | undefined;
          if (marking) {
            const parsed = countFromText(labelText(marking) ?? '');
            if (parsed) {
              count = parsed.value;
              if (!parsed.exact) {
                warn(
                  `The initial marking "${labelText(marking) ?? ''}" of ${child.name} ` +
                    `"${child.attributes['id'] ?? '?'}" was read as ${parsed.value}.`,
                );
              }
            } else {
              warn(
                `The initial marking of ${child.name} "${child.attributes['id'] ?? '?'}" is not a ` +
                  'number and was ignored.',
              );
            }
          }
          if (firstChild(child, 'hlinitialMarking')) {
            warn('High-level initial markings are not supported and were ignored.');
          }
          const silent = childElements(child, 'toolspecific').some(
            (spec) => spec.attributes['activity'] === '$invisible$',
          );
          nodes.push({
            kind: child.name,
            xmlId: child.attributes['id'],
            name: labelText(firstChild(child, 'name')),
            position: readPoint(graphics ? firstChild(graphics, 'position') : undefined),
            count,
            payload: readPayload(child, `${child.name} "${child.attributes['id'] ?? '?'}"`),
            silent,
            group,
          });
          break;
        }
        case 'referencePlace':
        case 'referenceTransition': {
          const id = child.attributes['id'];
          const ref = child.attributes['ref'];
          if (id !== undefined && ref !== undefined) references.set(id, ref);
          else warn(`A <${child.name}> without id or ref was ignored.`);
          break;
        }
        case 'arc': {
          const source = child.attributes['source'];
          const target = child.attributes['target'];
          if (source === undefined || target === undefined) {
            warn(
              `The arc "${child.attributes['id'] ?? '?'}" has no source or target and was skipped.`,
            );
            break;
          }
          const inscription = firstChild(child, 'inscription');
          let weight: number | undefined;
          if (inscription) {
            const parsed = countFromText(labelText(inscription) ?? '');
            if (parsed && parsed.value >= 1) {
              weight = parsed.value;
              if (!parsed.exact) {
                warn(
                  `The inscription "${labelText(inscription) ?? ''}" of arc ` +
                    `"${child.attributes['id'] ?? '?'}" was read as weight ${parsed.value}.`,
                );
              }
            } else {
              warn(
                `The inscription of arc "${child.attributes['id'] ?? '?'}" is not a positive ` +
                  'integer; the weight 1 was used.',
              );
            }
          }
          const typeChild = firstChild(child, 'type');
          const arcType = firstChild(child, 'arctype');
          const kind =
            child.attributes['type'] ??
            typeChild?.attributes['value'] ??
            (arcType ? labelText(arcType) : undefined);
          arcs.push({
            xmlId: child.attributes['id'],
            source,
            target,
            weight,
            points: readPoints(firstChild(child, 'graphics')),
            payload: readPayload(child, `arc "${child.attributes['id'] ?? '?'}"`),
            type: kind,
            group,
          });
          break;
        }
        case 'page': {
          pageCount += 1;
          groups += 1;
          collect(child, groups);
          break;
        }
        default:
          break;
      }
    }
  };
  collect(netEl, 0);
  groups += 1;

  const netPayload = readPayload(netEl, 'the net');
  if (finalMarkings) warn('Final markings are not supported and were ignored.');
  if (pageCount > 1) {
    warn(`The file has ${pageCount} pages; they were merged and placed next to each other.`);
  }

  // Ids. The original id from the extension wins, so a file written by this tool reads back
  // with the same ids.
  const taken = new Set<string>();
  const unique = (wanted: string, what: string): string => {
    if (!taken.has(wanted)) {
      taken.add(wanted);
      return wanted;
    }
    let n = 2;
    while (taken.has(`${wanted}_${n}`)) n += 1;
    const id = `${wanted}_${n}`;
    taken.add(id);
    warn(`The id "${wanted}" is used more than once; the ${what} got the id "${id}".`);
    return id;
  };
  const payloadId = (payload: Json | undefined): string | undefined => {
    const id = payload?.['id'];
    return typeof id === 'string' && id !== '' ? id : undefined;
  };

  const nodeIds = new Map<string, Id>();
  const kindOf = new Map<Id, 'place' | 'transition'>();
  let placeCounter = 0;
  let transitionCounter = 0;
  const finalIds = nodes.map((node) => {
    let wanted = payloadId(node.payload) ?? node.xmlId;
    if (wanted === undefined || wanted === '') {
      if (node.kind === 'place') {
        placeCounter += 1;
        wanted = `p${placeCounter}`;
      } else {
        transitionCounter += 1;
        wanted = `t${transitionCounter}`;
      }
      warn(`A ${node.kind} without id got the id "${wanted}".`);
    }
    const id = unique(wanted, node.kind);
    if (node.xmlId !== undefined && !nodeIds.has(node.xmlId)) nodeIds.set(node.xmlId, id);
    kindOf.set(id, node.kind);
    return id;
  });

  const resolve = (xmlId: string): Id | undefined => {
    let current = xmlId;
    for (let hops = 0; hops < 32; hops += 1) {
      const next = references.get(current);
      if (next === undefined) return nodeIds.get(current);
      current = next;
    }
    return undefined;
  };

  // Page offsets: pages with positions are put side by side.
  const offsets: number[] = Array.from({ length: groups }, () => 0);
  if (groups > 1) {
    const extent = (group: number): { min: number; max: number } | undefined => {
      let min = Infinity;
      let max = -Infinity;
      for (const node of nodes) {
        if (node.group !== group || !node.position) continue;
        min = Math.min(min, node.position.x);
        max = Math.max(max, node.position.x);
      }
      for (const arc of arcs) {
        if (arc.group !== group) continue;
        for (const point of arc.points) {
          min = Math.min(min, point.x);
          max = Math.max(max, point.x);
        }
      }
      return min <= max ? { min, max } : undefined;
    };
    let right: number | undefined;
    for (let group = 0; group < groups; group += 1) {
      const box = extent(group);
      if (!box) continue;
      if (right !== undefined) {
        offsets[group] = right + PAGE_GAP - box.min;
        right += PAGE_GAP + (box.max - box.min);
      } else right = box.max;
    }
  }
  const shift = (point: Position, group: number): Position => ({
    x: point.x + (offsets[group] ?? 0),
    y: point.y,
  });

  const origin: Position = { x: 0, y: 0 };
  let missingPositions = 0;
  const places: Place[] = [];
  const transitions: Transition[] = [];
  const marking: Marking = {};
  const profileValue = netPayload?.['profile'];
  const profile: Profile =
    profileValue === 'json-net' || profileValue === 'pt-net' ? profileValue : 'pt-net';

  nodes.forEach((node, index) => {
    const id = finalIds[index] ?? '';
    const payload = node.payload;
    const overrideName = typeof payload?.['name'] === 'string' ? payload['name'] : undefined;
    const name =
      overrideName ?? (node.name !== undefined && node.name !== '' ? node.name : undefined);
    const fallbackName = node.silent ? 'τ' : node.name === undefined ? id : '';
    const position = node.position ? shift(node.position, node.group) : origin;
    if (!node.position) missingPositions += 1;

    if (node.kind === 'place') {
      const place: Place = { id, name: name ?? fallbackName, position: { ...position } };
      if (typeof payload?.['type'] === 'string') place.type = payload['type'];
      const capacity = finite(payload?.['capacity']);
      if (capacity !== undefined) place.capacity = capacity;
      const role = payload?.['role'];
      if (role === 'case' || role === 'resource') place.role = role;
      places.push(place);

      let count = node.count;
      if (count !== undefined && count > MAX_TOKENS_PER_PLACE) {
        warn(
          `The place "${place.name}" has ${count} tokens; only ${MAX_TOKENS_PER_PLACE} were kept.`,
        );
        count = MAX_TOKENS_PER_PLACE;
      }
      const values = payload?.['tokens'];
      const tokens: Token[] | undefined =
        Array.isArray(values) && values.every(isToken) ? values : undefined;
      if (tokens && (count === undefined || count === tokens.length)) {
        if (tokens.length > 0) marking[id] = tokens;
      } else {
        if (tokens && count !== undefined) {
          warn(
            `The marking of place "${place.name}" was changed outside this tool; the token ` +
              'values were replaced by plain tokens.',
          );
        }
        if (count !== undefined && count > 0) marking[id] = Array.from({ length: count }, () => 1);
      }
    } else {
      const transition: Transition = { id, name: name ?? fallbackName, position: { ...position } };
      if (typeof payload?.['guard'] === 'string') transition.guard = payload['guard'];
      const timing = payload?.['timing'];
      if (timing !== undefined) {
        if (isTiming(timing)) transition.timing = timingOf(timing);
        else warn(`The timing of transition "${transition.name}" is not valid and was ignored.`);
      }
      const priority = finite(payload?.['priority']);
      if (priority !== undefined) transition.priority = priority;
      const rate = finite(payload?.['rate']);
      if (rate !== undefined) transition.rate = rate;
      transitions.push(transition);
    }
  });

  const resultArcs: Arc[] = [];
  const hints: Array<{ arcId: Id; text: string }> = [];
  let arcCounter = 0;
  for (const raw of arcs) {
    const source = resolve(raw.source);
    const target = resolve(raw.target);
    const label = raw.xmlId ?? `#${arcs.indexOf(raw) + 1}`;
    if (source === undefined || target === undefined) {
      warn(
        `The arc "${label}" refers to "${source === undefined ? raw.source : raw.target}", ` +
          'which is not in the net; the arc was skipped.',
      );
      continue;
    }
    let wanted = payloadId(raw.payload) ?? raw.xmlId;
    if (wanted === undefined || wanted === '') {
      arcCounter += 1;
      wanted = `a${arcCounter}`;
    }
    const id = unique(wanted, 'arc');
    const arc: Arc = { id, source, target, weight: raw.weight ?? 1 };
    if (typeof raw.payload?.['inscription'] === 'string')
      arc.inscription = raw.payload['inscription'];
    if (raw.points.length > 0) arc.points = raw.points.map((point) => shift(point, raw.group));
    resultArcs.push(arc);

    const kind = raw.type?.trim().toLowerCase();
    if (kind !== undefined && kind !== '' && kind !== 'normal') {
      const nameOf = (nodeId: Id): string =>
        places.find((p) => p.id === nodeId)?.name ??
        transitions.find((t) => t.id === nodeId)?.name ??
        nodeId;
      const text = `${kind} arc ${nameOf(source)} → ${nameOf(target)} (imported as a normal arc)`;
      hints.push({ arcId: id, text });
      warn(`The ${text}.`);
    }
  }

  // Positions may all be placeholders, or all equal: then they say nothing.
  const everyone = [...places, ...transitions];
  const spots = new Set(everyone.map((n) => `${n.position.x}:${n.position.y}`));
  const needsLayout = missingPositions > 0 || (everyone.length > 1 && spots.size === 1);

  // A file of this tool keeps an empty name; for other files the id is better than nothing.
  let name = typeof netPayload?.['name'] === 'string' ? netPayload['name'] : undefined;
  if (name === undefined) name = labelText(firstChild(netEl, 'name'));
  if (name === undefined || (name === '' && netPayload === undefined)) {
    name = netEl.attributes['id'] || 'Imported net';
  }

  const types = isRecord(netPayload?.['types']) ? netPayload['types'] : {};
  const net: PetriNet = {
    version: '1.0',
    profile,
    name,
    types,
    places,
    transitions,
    arcs: resultArcs,
    marking,
  };

  const strayMarking = netPayload?.['strayMarking'];
  if (isRecord(strayMarking)) {
    for (const [id, tokens] of Object.entries(strayMarking)) {
      if (Array.isArray(tokens) && tokens.every(isToken) && !(id in marking)) marking[id] = tokens;
    }
  }

  const annotations: Annotation[] = [];
  const noted = netPayload?.['annotations'];
  if (Array.isArray(noted)) {
    for (const entry of noted) {
      if (!isRecord(entry)) continue;
      const position = isRecord(entry['position'])
        ? { x: finite(entry['position']['x']), y: finite(entry['position']['y']) }
        : undefined;
      if (
        typeof entry['id'] === 'string' &&
        entry['id'] !== '' &&
        typeof entry['text'] === 'string' &&
        position?.x !== undefined &&
        position.y !== undefined
      ) {
        annotations.push({
          id: unique(entry['id'], 'annotation'),
          text: entry['text'],
          position: { x: position.x, y: position.y },
        });
      }
    }
  }
  for (const hint of hints) {
    annotations.push({
      id: unique(`note-${hint.arcId}`, 'annotation'),
      text: hint.text,
      position: { x: 0, y: 0 },
    });
  }
  if (annotations.length > 0) net.annotations = annotations;
  placeHints(net);

  const simulation = netPayload?.['simulation'];
  if (isRecord(simulation)) {
    const settings: SimulationSettings = {};
    const seed = finite(simulation['seed']);
    if (seed !== undefined) settings.seed = seed;
    const warmup = finite(simulation['warmup']);
    if (warmup !== undefined) settings.warmup = warmup;
    if (typeof simulation['startTime'] === 'string') settings.startTime = simulation['startTime'];
    if (typeof simulation['caseIdPrefix'] === 'string') {
      settings.caseIdPrefix = simulation['caseIdPrefix'];
    }
    net.simulation = settings;
  }
  if (netPayload?.['domainView'] !== undefined) net.domainView = netPayload['domainView'];
  if (netPayload?.['domainViewGeneration'] !== undefined) {
    net.domainViewGeneration = netPayload['domainViewGeneration'];
  }
  if (netPayload?.['properties'] !== undefined) net.properties = netPayload['properties'];

  let checked: PetriNet;
  try {
    checked = parseNet(net);
  } catch (error) {
    if (error instanceof NetFormatError) {
      throw new PnmlError(`The net in the file is not valid: ${error.issues.join('; ')}`);
    }
    throw error;
  }
  const importWarnings = [...warnings];
  const diagnostics = validate(checked);
  for (const diagnostic of diagnostics) {
    warnings.push(
      `${diagnostic.severity === 'error' ? 'Error' : 'Check'}: ${diagnostic.message}` +
        (diagnostic.elementId !== undefined ? ` (${diagnostic.elementId})` : ''),
    );
  }
  return { net: checked, warnings, importWarnings, diagnostics, needsLayout };
}

/** Puts the notes about imported special arcs (`note-<arc id>`) next to the middle of their arc. */
function placeHints(net: PetriNet): void {
  if (!net.annotations) return;
  const nodes = new Map<Id, Position>();
  for (const node of [...net.places, ...net.transitions]) nodes.set(node.id, node.position);
  for (const note of net.annotations) {
    if (!note.id.startsWith('note-')) continue;
    const arc = net.arcs.find((a) => `note-${a.id}` === note.id);
    const from = arc && nodes.get(arc.source);
    const to = arc && nodes.get(arc.target);
    if (from && to) {
      note.position = {
        x: Math.round((from.x + to.x) / 2),
        y: Math.round((from.y + to.y) / 2) - 50,
      };
    }
  }
}

/**
 * Reads a PNML file and lays the net out with ELK (direction RIGHT) if positions are missing or
 * `layout: 'auto'` asks for it. Accepts `ptnet`, `pnmlcoremodel` and other types (with a warning),
 * several pages, reference places and transitions, and special arcs (read as normal arcs). The
 * `pnm` extension written by `toPnml` is read back completely.
 *
 * Throws `PnmlError` if the text is not well-formed XML or holds no net.
 */
export async function fromPnml(xml: string, options: PnmlReadOptions = {}): Promise<PnmlImport> {
  const parsed = parsePnml(xml);
  const auto = options.layout === 'auto';
  if (!auto && !parsed.needsLayout) {
    return {
      net: parsed.net,
      warnings: parsed.warnings,
      importWarnings: parsed.importWarnings,
      diagnostics: parsed.diagnostics,
      laidOut: false,
    };
  }
  // Loaded on demand: the layout engine is large and only needed for files without positions.
  const { layoutNet } = await import('@pnm/layout');
  const positions = await layoutNet(parsed.net, { direction: 'RIGHT' });
  const net: PetriNet = {
    ...parsed.net,
    places: parsed.net.places.map((p) => ({ ...p, position: positions[p.id] ?? p.position })),
    transitions: parsed.net.transitions.map((t) => ({
      ...t,
      position: positions[t.id] ?? t.position,
    })),
    // Bend points belong to the old positions.
    arcs: parsed.net.arcs.map(({ points: _points, ...arc }) => arc),
    ...(parsed.net.annotations && {
      annotations: parsed.net.annotations.map((a) => ({ ...a, position: { ...a.position } })),
    }),
  };
  placeHints(net);
  const note = 'The file has no (or incomplete) positions; the net was laid out automatically.';
  return {
    net,
    warnings: auto ? parsed.warnings : [note, ...parsed.warnings],
    importWarnings: auto ? parsed.importWarnings : [note, ...parsed.importWarnings],
    diagnostics: parsed.diagnostics,
    laidOut: true,
  };
}
