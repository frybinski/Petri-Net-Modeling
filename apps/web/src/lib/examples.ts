import { parseNetText, type PetriNet } from '@pnm/core';

// Example nets are embedded at build time from the repository's examples/ folder.
const sources = import.meta.glob('../../../../examples/*.pn.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Example {
  id: string;
  name: string;
  net: PetriNet;
}

let cache: Example[] | undefined;

/** All bundled example nets, sorted by name. Files that fail to parse are skipped. */
export function listExamples(): Example[] {
  if (cache) return cache;
  const examples: Example[] = [];
  for (const [path, text] of Object.entries(sources)) {
    try {
      const net = parseNetText(text);
      const id =
        path
          .split('/')
          .pop()
          ?.replace(/\.pn\.json$/, '') ?? path;
      examples.push({ id, name: net.name, net });
    } catch {
      // A broken example must not break the app; the core tests guard the files.
    }
  }
  cache = examples.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}
