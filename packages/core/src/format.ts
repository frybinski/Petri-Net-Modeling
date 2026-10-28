import type { PetriNet, Profile } from './model';
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
      position: { x: p.position.x, y: p.position.y },
    })),
    transitions: net.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.guard !== undefined && { guard: t.guard }),
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
  if (net.annotations) {
    out.annotations = net.annotations.map((a) => ({
      id: a.id,
      text: a.text,
      position: { x: a.position.x, y: a.position.y },
    }));
  }
  return out;
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
