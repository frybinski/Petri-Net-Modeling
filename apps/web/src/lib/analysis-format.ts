import { tokenLabel, type Id, type Marking, type PetriNet } from '@pnm/core';
import type { Step } from '@pnm/analysis';
import { en } from '../i18n/en';

/** The name of a place or transition, falling back to its id. */
export function elementName(net: PetriNet, id: Id): string {
  const node = net.places.find((p) => p.id === id) ?? net.transitions.find((t) => t.id === id);
  return node === undefined || node.name === '' ? id : node.name;
}

/**
 * A marking as text: `Producer idle, Buffer ×2`. In JSON nets the tokens are listed:
 * `Orders [{id:"A-1"…}, 3]`. At most `max` places are named, the rest is summarised.
 */
export function markingText(net: PetriNet, marking: Marking, max = 6): string {
  const entries = net.places
    .map((place) => ({ place, tokens: marking[place.id] ?? [] }))
    .filter((entry) => entry.tokens.length > 0);
  if (entries.length === 0) return en.analysis.space.noTokens;
  const parts = entries.slice(0, max).map(({ place, tokens }) => {
    const name = place.name === '' ? place.id : place.name;
    if (net.profile === 'pt-net') return tokens.length > 1 ? `${name} ×${tokens.length}` : name;
    const shown = tokens.slice(0, 3).map((t) => tokenLabel(t, 14));
    return `${name} [${shown.join(', ')}${tokens.length > 3 ? ', …' : ''}]`;
  });
  if (entries.length > max) parts.push(`+${entries.length - max}`);
  return parts.join(', ');
}

/** A firing step as text: the transition name, with the binding in JSON nets. */
export function stepText(net: PetriNet, step: Step, maxToken = 14): string {
  const name = elementName(net, step.transitionId);
  const binding = step.binding ?? {};
  const entries = Object.entries(binding);
  if (entries.length === 0) return name;
  return `${name} (${entries.map(([k, v]) => `$${k}=${tokenLabel(v, maxToken)}`).join(', ')})`;
}
