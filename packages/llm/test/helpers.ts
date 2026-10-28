import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import type { DomainView } from '@pnm/domain';

const examples = join(import.meta.dirname, '..', '..', '..', 'examples');

/** An example net of the repository with its stored domain view. */
export function loadExample(id: string): { net: PetriNet; view: DomainView } {
  const net = parseNetText(readFileSync(join(examples, `${id}.pn.json`), 'utf8'));
  return { net, view: net.domainView as DomainView };
}

export const EXAMPLE_IDS = ['parcel-center', 'smart-office'] as const;

/** What a model would write for the net: the stored view without hash and provenance. */
export function modelAnswer(view: DomainView): Record<string, unknown> {
  const { netHash: _hash, provenance: _provenance, ...rest } = view;
  return structuredClone(rest) as Record<string, unknown>;
}
