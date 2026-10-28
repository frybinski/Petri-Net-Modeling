import {
  tokenLabel,
  type BindingResult,
  type Diagnostic,
  type Id,
  type Marking,
  type PetriNet,
} from '@pnm/core';
import { MAX_CARD_TOKENS } from './flow-model';
import { boundVariables } from './inscriptions';
import { describeTiming } from './sim-format';

export interface HoverCardModel {
  id: Id;
  kind: 'place' | 'transition';
  name: string;
  /** Place type (JSON nets). */
  typeName?: string;
  /** Number of tokens of a place. */
  tokenCount?: number;
  /** Labels of the first tokens of a place in a JSON net. */
  tokens: string[];
  /** Tokens beyond the listed ones. */
  moreTokens: number;
  capacity?: number;
  /** Full guard of a transition (JSON nets). */
  guard?: string;
  /** Variables a transition binds, with the place they come from (JSON nets). */
  variables: Array<{ name: string; place: string }>;
  /** While simulating: number of bindings of a transition (0 when it is not enabled). */
  bindings?: number;
  /** Duration of a transition, as text. */
  timing?: string;
  priority?: number;
  /** Arrivals per hour of a source transition. */
  rate?: number;
  /** While simulating: firings of a transition that are under way. */
  running?: number;
  /** Error messages of the element. */
  errors: string[];
}

interface HoverCardInput {
  net: PetriNet;
  marking: Marking;
  id: Id;
  diagnostics: readonly Diagnostic[];
  /** Set while simulating. */
  enabled?: ReadonlyMap<Id, BindingResult> | undefined;
  /** Firings of the transition that are under way (simulation of a timed net). */
  running?: number | undefined;
}

/** What the hover card of a node shows. Returns null for elements without a card (notes). */
export function buildHoverCard({
  net,
  marking,
  id,
  diagnostics,
  enabled,
  running,
}: HoverCardInput): HoverCardModel | null {
  const errors = diagnostics
    .filter((d) => d.severity === 'error' && d.elementId === id)
    .map((d) => d.message)
    .slice(0, 3);
  const json = net.profile === 'json-net';
  const place = net.places.find((p) => p.id === id);
  if (place) {
    const tokens = marking[id] ?? [];
    return {
      id,
      kind: 'place',
      name: place.name,
      ...(json && place.type !== undefined && { typeName: place.type }),
      tokenCount: tokens.length,
      tokens: json ? tokens.slice(0, MAX_CARD_TOKENS).map((t) => tokenLabel(t, 60)) : [],
      moreTokens: json ? Math.max(0, tokens.length - MAX_CARD_TOKENS) : 0,
      ...(place.capacity !== undefined && { capacity: place.capacity }),
      variables: [],
      errors,
    };
  }
  const transition = net.transitions.find((t) => t.id === id);
  if (!transition) return null;
  const guard = transition.guard?.trim();
  return {
    id,
    kind: 'transition',
    name: transition.name,
    tokens: [],
    moreTokens: 0,
    ...(json && guard ? { guard } : {}),
    variables: json
      ? boundVariables(net, id).map((v) => ({ name: v.name, place: v.placeName }))
      : [],
    ...(enabled !== undefined && { bindings: enabled.get(id)?.bindings.length ?? 0 }),
    ...(transition.timing && { timing: describeTiming(transition.timing) }),
    ...(transition.priority !== undefined && { priority: transition.priority }),
    ...(transition.rate !== undefined && { rate: transition.rate }),
    ...(running !== undefined && running > 0 && { running }),
    errors,
  };
}
