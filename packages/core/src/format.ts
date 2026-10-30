import type {
  Indicator,
  IndicatorMeasure,
  PetriNet,
  Profile,
  SimulationSettings,
  Timing,
} from './model';
import { formatIssues, netSchema } from './schema';

/** Raised by `parseNet` when the input is not a valid net document. */
export class NetFormatError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      issues.length === 1
        ? `Invalid net file: ${issues[0]}`
        : `Invalid net file:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'NetFormatError';
    this.issues = issues;
  }
}

export function createEmptyNet(name = 'Untitled net', profile: Profile = 'pt-net'): PetriNet {
  return {
    version: '1.0',
    profile,
    name,
    types: {},
    places: [],
    transitions: [],
    arcs: [],
    marking: {},
  };
}

/**
 * Checks the structure of an untrusted value and returns it as a net.
 * Semantic problems (dangling arcs, bad weights, ...) are reported by `validate`.
 */
export function parseNet(json: unknown): PetriNet {
  const result = netSchema.safeParse(json);
  if (!result.success) throw new NetFormatError(formatIssues(result.error).slice(0, 10));
  return result.data;
}

/** Parses the text of a `.pn.json` file. */
export function parseNetText(text: string): PetriNet {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new NetFormatError([`not valid JSON (${detail})`]);
  }
  return parseNet(json);
}

/** Serializes with a fixed key order and 2-space indentation, so files diff cleanly. */
export function serializeNet(net: PetriNet): string {
  return `${JSON.stringify(canonical(net), null, 2)}\n`;
}

function canonical(net: PetriNet): Record<string, unknown> {
  const out: Record<string, unknown> = {
    version: net.version,
    profile: net.profile,
    name: net.name,
    types: net.types,
    places: net.places.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.type !== undefined && { type: p.type }),
      ...(p.capacity !== undefined && { capacity: p.capacity }),
      ...(p.role !== undefined && { role: p.role }),
      position: { x: p.position.x, y: p.position.y },
    })),
    transitions: net.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.guard !== undefined && { guard: t.guard }),
      ...(t.timing !== undefined && { timing: canonicalTiming(t.timing) }),
      ...(t.priority !== undefined && { priority: t.priority }),
      ...(t.rate !== undefined && { rate: t.rate }),
      position: { x: t.position.x, y: t.position.y },
    })),
    arcs: net.arcs.map((a) => ({
      id: a.id,
      source: a.source,
      target: a.target,
      weight: a.weight,
      ...(a.inscription !== undefined && { inscription: a.inscription }),
      ...(a.points !== undefined && { points: a.points.map((p) => ({ x: p.x, y: p.y })) }),
    })),
    marking: canonicalMarking(net),
  };
  if (net.simulation) out.simulation = canonicalSimulation(net.simulation);
  if (net.domainView !== undefined) out.domainView = net.domainView;
  if (net.domainViewGeneration !== undefined) out.domainViewGeneration = net.domainViewGeneration;
  if (net.properties !== undefined) out.properties = net.properties;
  if (net.annotations) {
    out.annotations = net.annotations.map((a) => ({
      id: a.id,
      text: a.text,
      position: { x: a.position.x, y: a.position.y },
    }));
  }
  return out;
}

function canonicalTiming(timing: Timing): Timing {
  switch (timing.kind) {
    case 'fixed':
      return { kind: 'fixed', value: timing.value };
    case 'uniform':
      return { kind: 'uniform', min: timing.min, max: timing.max };
    case 'exponential':
      return { kind: 'exponential', mean: timing.mean };
  }
}

function canonicalSimulation(settings: SimulationSettings): SimulationSettings {
  return {
    ...(settings.seed !== undefined && { seed: settings.seed }),
    ...(settings.warmup !== undefined && { warmup: settings.warmup }),
    ...(settings.startTime !== undefined && { startTime: settings.startTime }),
    ...(settings.caseIdPrefix !== undefined && { caseIdPrefix: settings.caseIdPrefix }),
    ...(settings.indicators !== undefined && {
      indicators: settings.indicators.map(canonicalIndicator),
    }),
  };
}

function canonicalMeasure(measure: IndicatorMeasure): IndicatorMeasure {
  switch (measure.kind) {
    case 'tokens':
    case 'firings':
      return { kind: measure.kind, of: measure.of };
    case 'inflow':
    case 'outflow':
      return {
        kind: measure.kind,
        of: measure.of,
        ...(measure.via !== undefined && { via: measure.via }),
      };
  }
}

function canonicalIndicator(indicator: Indicator): Indicator {
  return {
    id: indicator.id,
    label: indicator.label,
    ...(indicator.unit !== undefined && { unit: indicator.unit }),
    measure: canonicalMeasure(indicator.measure),
    ...(indicator.per !== undefined && {
      per: typeof indicator.per === 'string' ? indicator.per : canonicalMeasure(indicator.per),
    }),
    ...(indicator.factor !== undefined && { factor: indicator.factor }),
    ...(indicator.digits !== undefined && { digits: indicator.digits }),
  };
}

/** Marking entries follow place order; entries for unknown places come last, sorted. */
function canonicalMarking(net: PetriNet): PetriNet['marking'] {
  const out: PetriNet['marking'] = {};
  for (const place of net.places) {
    const tokens = net.marking[place.id];
    if (tokens && tokens.length > 0) out[place.id] = tokens;
  }
  for (const id of Object.keys(net.marking).sort()) {
    const tokens = net.marking[id];
    if (!(id in out) && tokens && tokens.length > 0) out[id] = tokens;
  }
  return out;
}
