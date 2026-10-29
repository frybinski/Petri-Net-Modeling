import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { distanceToSegment, type DomainView, type Point } from '../src';

const net = parseNetText(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'examples', 'smart-office.pn.json'),
    'utf8',
  ),
);
const view = net.domainView as DomainView;

/** How close a polyline comes to a point. */
function distance(path: readonly Point[], point: Point): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, path[i]!, path[i + 1]!));
  }
  return best;
}

describe('the routes of the smart office', () => {
  it('keep clear of the waypoints and doors that they do not belong to', () => {
    const marks = Object.entries(view.transitions).flatMap(([id, entry]) =>
      'pos' in entry
        ? [{ id, pos: entry.pos as Point, radius: entry.kind === 'waypoint' ? 11 : 20 }]
        : [],
    );
    expect(marks.length).toBeGreaterThan(2);
    for (const mark of marks) {
      for (const [key, arc] of Object.entries(view.arcs ?? {})) {
        const [source, target] = key.split('>');
        if (source === mark.id || target === mark.id) continue;
        expect(distance(arc.path, mark.pos), `${key} runs through ${mark.id}`).toBeGreaterThan(
          mark.radius + 2,
        );
      }
    }
  });
});
