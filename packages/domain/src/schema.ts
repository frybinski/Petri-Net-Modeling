import type { Id } from '@pnm/core';
import { z } from 'zod';

/** A point `[x, y]` in canvas pixels. */
export type Point = [number, number];
/** A rectangle `[x, y, width, height]` in canvas pixels. */
export type Rect = [number, number, number, number];
/** The picture a case is drawn as. */
export type Sprite = 'parcel' | 'person' | 'vehicle' | 'document' | 'dot';

export const SPRITES: readonly Sprite[] = ['parcel', 'person', 'vehicle', 'document', 'dot'];

export type PathPlaceKind = 'queue' | 'conveyor' | 'buffer';
export type BoxPlaceKind = 'source' | 'sink';
export type CardTransitionKind = 'station' | 'machine' | 'gate';
export type AreaTransitionKind = 'area' | 'rooms';
export type PointTransitionKind = 'door' | 'dock' | 'waypoint';

export type PlaceView =
  | { kind: PathPlaceKind; path: Point[]; label?: string }
  | { kind: 'slots'; of: Id; label?: string }
  | { kind: 'pool'; pos: Point; label?: string }
  | { kind: BoxPlaceKind; box: Rect; label?: string }
  | { kind: 'hidden'; reason: string };

export type TransitionView =
  | { kind: CardTransitionKind; box: Rect; slots?: Point[]; label?: string; sensor?: string }
  | {
      kind: AreaTransitionKind;
      box: Rect;
      slots: Point[];
      rooms?: Rect[];
      label?: string;
      sensor?: string;
    }
  | { kind: PointTransitionKind; pos: Point; pass?: boolean; label?: string; sensor?: string }
  | { kind: 'hidden'; reason: string };

export type Decor =
  | { kind: 'room' | 'zone'; rect: Rect; label?: string }
  /** Each segment is `[x1, y1, x2, y2]`. */
  | { kind: 'wall'; segs: Rect[]; width?: number }
  | { kind: 'label'; pos: Point; text: string }
  | { kind: 'furniture'; rect: Rect }
  /** A scale bar starting at `pos`, `px` pixels long. */
  | { kind: 'scale'; pos: Point; px: number; label: string };

export type ProvenanceSource = 'llm' | 'user' | 'generic';

export interface Provenance {
  source: ProvenanceSource;
  model?: string;
  /** ISO timestamp. */
  at: string;
}

export interface DomainMeta {
  theme: string;
  viewName: string;
  entity: { singular: string; plural: string; sprite: Sprite };
  canvas: { width: number; height: number };
  metersPerPixel?: number;
}

export interface DomainView {
  schemaVersion: 1;
  /** `fnv1a64:<16 hex digits>` of the net structure the view was made for. */
  netHash: string;
  meta: DomainMeta;
  places: Record<Id, PlaceView>;
  transitions: Record<Id, TransitionView>;
  /** Keys are `<sourceId>><targetId>`. */
  arcs?: Record<string, { path: Point[] }>;
  decor?: Decor[];
  /** Keys are `places.<id>`, `transitions.<id>` or `arcs.<key>`. */
  provenance: Record<string, Provenance>;
}

const finite = z.number().refine(Number.isFinite, { message: 'must be a finite number' });
const point = z.tuple([finite, finite]);
const rect = z.tuple([finite, finite, finite, finite]);
const label = z.string().optional();

const spriteSchema = z.enum(['parcel', 'person', 'vehicle', 'document', 'dot']);

const placeViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['queue', 'conveyor', 'buffer']),
    path: z.array(point),
    label,
  }),
  z.strictObject({ kind: z.literal('slots'), of: z.string(), label }),
  z.strictObject({ kind: z.literal('pool'), pos: point, label }),
  z.strictObject({ kind: z.enum(['source', 'sink']), box: rect, label }),
  z.strictObject({ kind: z.literal('hidden'), reason: z.string() }),
]);

const transitionViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['station', 'machine', 'gate']),
    box: rect,
    slots: z.array(point).optional(),
    label,
    sensor: z.string().optional(),
  }),
  z.strictObject({
    kind: z.enum(['area', 'rooms']),
    box: rect,
    slots: z.array(point),
    rooms: z.array(rect).optional(),
    label,
    sensor: z.string().optional(),
  }),
  z.strictObject({
    kind: z.enum(['door', 'dock', 'waypoint']),
    pos: point,
    pass: z.boolean().optional(),
    label,
    sensor: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal('hidden'), reason: z.string() }),
]);

const decorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['room', 'zone']), rect, label }),
  z.strictObject({ kind: z.literal('wall'), segs: z.array(rect), width: finite.optional() }),
  z.strictObject({ kind: z.literal('label'), pos: point, text: z.string() }),
  z.strictObject({ kind: z.literal('furniture'), rect }),
  z.strictObject({ kind: z.literal('scale'), pos: point, px: finite, label: z.string() }),
]);

const provenanceSchema = z.strictObject({
  source: z.enum(['llm', 'user', 'generic']),
  model: z.string().optional(),
  at: z.string(),
});

const metaSchema = z.strictObject({
  theme: z.string(),
  viewName: z.string(),
  entity: z.strictObject({
    singular: z.string(),
    plural: z.string(),
    sprite: spriteSchema,
  }),
  canvas: z.strictObject({
    width: finite.refine((n) => n > 0, 'must be positive'),
    height: finite.refine((n) => n > 0, 'must be positive'),
  }),
  metersPerPixel: finite.refine((n) => n > 0, 'must be positive').optional(),
});

export const domainViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  netHash: z.string(),
  meta: metaSchema,
  places: z.record(z.string(), placeViewSchema),
  transitions: z.record(z.string(), transitionViewSchema),
  arcs: z.record(z.string(), z.strictObject({ path: z.array(point) })).optional(),
  decor: z.array(decorSchema).optional(),
  provenance: z.record(z.string(), provenanceSchema),
}) satisfies z.ZodType<DomainView, unknown>;

/**
 * The JSON Schema (draft 2020-12) of a domain view, for prompts that ask a language model to
 * write one (D3) and for external tools.
 */
export function domainViewJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(domainViewSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}

/**
 * Re-creates the view in the key order of the schema, so that files diff cleanly. Throws if the
 * value is not a valid view (check with `validateDomainView` first).
 */
export function normalizeDomainView(view: DomainView): DomainView {
  return domainViewSchema.parse(view);
}

/** The keys of the provenance map for a place, transition or arc. */
export const provenanceKey = {
  place: (id: Id): string => `places.${id}`,
  transition: (id: Id): string => `transitions.${id}`,
  arc: (key: string): string => `arcs.${key}`,
};

/** The key of an arc in `DomainView.arcs`. */
export function arcKey(source: Id, target: Id): string {
  return `${source}>${target}`;
}
