import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  buildDynamicScene,
  buildScene,
  buildStaticScene,
  layoutContext,
  type DomainView,
} from '../src';
import { runAnimated } from './animated-run';

/**
 * Acceptance N2-3: the scenes of the views that use none of the new fields are exactly the scenes
 * of 1.3.0. The fixture holds a hash per example of
 *
 * - the static scene (what the sheet shows without tokens),
 * - the scene with the initial marking (what an export shows), and
 * - every frame of a simulated run (the dynamic scene and the sprites at rest and under way),
 *
 * taken with version 1.3.0 before the pictures of quantities and the appearance of cases existed.
 * The view of the bicycle frame production uses the new fields since 1.4.0; they are stripped
 * from it here, so that what is left must still be drawn as before. Regenerate only for a change
 * that is meant to alter the pictures of such views (`PNM_WRITE_GOLDEN=1`), never to get green.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'scenes-1.3.0.json');
const ROOT = join(import.meta.dirname, '..', '..', '..');
const NAMES = ['parcel-center', 'smart-office', 'bike-frames'] as const;
/** The entity sprite of the bicycle frame view in 1.3.0. */
const SPRITE_1_3_0: Record<string, string> = { 'bike-frames': 'vehicle' };

const load = (name: string): PetriNet =>
  parseNetText(readFileSync(join(ROOT, 'examples', `${name}.pn.json`), 'utf8'));

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The view as 1.3.0 knew it: without `display` and `appearance`, with the old entity sprite. */
function asIn130(name: string, view: DomainView): DomainView {
  const copy = structuredClone(view) as DomainView;
  for (const entry of Object.values(copy.places)) {
    const loose = entry as unknown as Record<string, unknown>;
    delete loose['display'];
    delete loose['appearance'];
  }
  const sprite = SPRITE_1_3_0[name];
  if (sprite !== undefined) {
    (copy.meta.entity as { sprite: string }).sprite = sprite;
  }
  return copy;
}

async function digests(name: string): Promise<Record<string, string>> {
  const net = load(name);
  const view = asIn130(name, net.domainView as DomainView);
  const context = layoutContext(net, view);
  const staticScene = buildStaticScene(net, view);
  const frames = createHash('sha256');
  let count = 0;
  await runAnimated(net, view, {
    bundle: 150,
    seconds: 3 * 3600,
    wallStep: 40,
    seed: 7,
    onBundle: (_bundle, anim, layout, now) => {
      const dynamic = buildDynamicScene(context, staticScene, layout, anim, {
        now,
        simTime: layout.time,
      });
      frames.update(
        JSON.stringify({
          layers: dynamic.layers,
          sprites: dynamic.sprites.map((s) => ({
            key: s.key,
            caseId: s.caseId,
            point: s.point,
            direction: s.direction,
            moving: s.moving,
            state: s.state,
          })),
          stations: [...dynamic.stations.values()],
        }),
      );
      count += 1;
    },
  });
  return {
    static: sha(staticScene),
    marking: sha(buildScene(net, view, net.marking)),
    frames: frames.digest('hex'),
    frameCount: String(count),
  };
}

describe('acceptance N2-3: scenes of views without the new fields are unchanged since 1.3.0', () => {
  if (process.env['PNM_WRITE_GOLDEN'] === '1') {
    it('writes the fixture', async () => {
      const all: Record<string, Record<string, string>> = {};
      for (const name of NAMES) all[name] = await digests(name);
      writeFileSync(FIXTURE, `${JSON.stringify(all, null, 2)}\n`);
    }, 120_000);
    return;
  }

  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    Record<string, string>
  >;

  it('the fixture covers the parcel center, the smart office and the bicycle frame production', () => {
    expect(Object.keys(golden).sort()).toEqual([...NAMES].sort());
  });

  for (const name of NAMES) {
    it(`${name}: same static scene, same scene with the marking and same frames of a run`, async () => {
      expect(await digests(name)).toEqual(golden[name]);
    }, 120_000);
  }
});
