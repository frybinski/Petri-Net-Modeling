import type { Id, PetriNet } from '@pnm/core';
import {
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  EMPTY_ANIMATION,
  INSTANT,
  emptyMoved,
  isAnimating,
  layoutContext,
  mergeMoved,
  movedEntries,
  layoutTokens,
  pruneAnimation,
  rewindHistory,
  sceneOnly,
  sceneWithout,
  staticLayoutState,
  type AnimationState,
  type DomainView,
  type DrawCommand,
  type DynamicOptions,
  type DynamicScene,
  type LayoutContext,
  type Layer,
  type LayoutState,
  type MovedEntries,
  type Scene,
  type SpriteSample,
  type StationInfo,
  type TokenLayout,
} from '@pnm/domain';
import type { SimEvent } from '@pnm/sim';
import { currentSimState } from './domain-state';

/** Entries of the log of handled events that the app keeps (the tests keep all). */
const LOG_LIMIT = 600;

/** The clock never runs ahead of the last bundle by more than this many wall-clock seconds. */
const MAX_AHEAD_SECONDS = 0.25;

export interface ClockInput {
  playing: boolean;
  /** Simulated seconds per second; `'max'` or `null` for no extrapolation. */
  speed: number | 'max' | null;
  /** Time of the next instant at which something happens. */
  nextEvent: number | null;
}

/** A drag of the mode "Edit layout" in progress: what follows the pointer, apart from the rest. */
interface DragPreview {
  /** The entries that differ from the view of the document, collected over the whole drag. */
  moved: MovedEntries;
  /** The scene of the previewed view, for the dynamic part of the frame (marks, tokens). */
  scene: Scene;
  context: LayoutContext;
  layout: TokenLayout;
  /** The commands of the moved entries, drawn above the static layer. */
  layers: Record<Layer, DrawCommand[]>;
}

/**
 * The animation of the domain view as a plain object, so that it can be tested without a canvas:
 * it holds the static scene, the layout of the tokens and the animation state, takes the bundles
 * of events in the order in which they arrive and produces the dynamic scene of a frame. It never
 * waits for the simulator and the simulator never waits for it.
 */
export class DomainAnimator {
  net: PetriNet | null = null;
  view: DomainView | null = null;
  context: LayoutContext | null = null;
  /** The scene that the static layer shows; during a drag it lacks the entries that move. */
  staticScene: Scene | null = null;
  layout: TokenLayout | null = null;
  /** The scene of the view of the document, whole (hit tests use it, also during a drag). */
  private wholeScene: Scene | null = null;
  private drag: DragPreview | null = null;
  anim: AnimationState = EMPTY_ANIMATION;
  /** Wall-clock time at which the latest bundle arrived. */
  receivedAt = 0;
  /** The sprites and station states of the latest frame, for hit tests and the hover card. */
  sprites: readonly SpriteSample[] = [];
  stations: ReadonlyMap<Id, StationInfo> = new Map();
  private instant = false;
  /** Bundles processed since the model was set, for the tests and the status of the canvas. */
  bundles = 0;
  /** Deviations of a replay seen since the model was set, for the tests and the status of the canvas. */
  deviations = 0;

  /** Sets the net and its view (or `null` if there is none to draw) and snaps to the state. */
  setModel(net: PetriNet, view: DomainView | null, state: LayoutState): void {
    this.net = net;
    this.view = view;
    this.drag = null;
    // A new net or view starts its curves again.
    this.anim = EMPTY_ANIMATION;
    if (view) {
      this.context = layoutContext(net, view);
      this.wholeScene = buildStaticScene(net, view);
      this.staticScene = this.wholeScene;
    } else {
      this.context = null;
      this.wholeScene = null;
      this.staticScene = null;
    }
    this.snap(state);
  }

  /**
   * Shows `next` as the view of a drag without rebuilding the static layer for every move: the
   * entries that differ from the view of the document leave the static scene (once, when the drag
   * starts, and again if another entry joins) and are drawn on their own, so that a move costs the
   * scene of the previewed view and not a new rendering of the whole sheet.
   */
  previewView(net: PetriNet, next: DomainView, state: LayoutState): void {
    const base = this.view;
    const whole = this.wholeScene;
    if (!base || !whole) return;
    const moved = this.drag?.moved ?? emptyMoved();
    const grew = mergeMoved(moved, movedEntries(net, base, next));
    if (grew || !this.drag) this.staticScene = sceneWithout(whole, moved);
    const scene = buildStaticScene(net, next);
    this.drag = {
      moved,
      scene,
      context: layoutContext(net, next),
      layout: layoutTokens(net, next, state),
      layers: sceneOnly(scene, moved),
    };
  }

  /** The commands that a drag draws above the static layer, or `null` when nothing is dragged. */
  get dragLayers(): Record<Layer, DrawCommand[]> | null {
    return this.drag?.layers ?? null;
  }

  /**
   * All tokens jump to the layout of `state`; running motions end. The curves of the counters
   * are cut at the time of the state (a step back) or start again (a reset to time 0).
   */
  snap(state: LayoutState): void {
    const layout = this.net && this.view ? layoutTokens(this.net, this.view, state) : null;
    const history =
      layout && this.context ? rewindHistory(this.anim.history, this.context, layout) : undefined;
    this.anim = history !== undefined ? { ...EMPTY_ANIMATION, history } : EMPTY_ANIMATION;
    this.layout = layout;
  }

  /** Tokens jump and elements do not flash (speed "max", reduced motion). */
  setInstant(instant: boolean): void {
    this.instant = instant;
  }

  /** Processes a bundle of events whose resulting state is `state`. */
  ingest(events: readonly SimEvent[], state: LayoutState, now: number): void {
    if (!this.net || !this.view || !this.context || !this.layout) return;
    const after = layoutTokens(this.net, this.view, state);
    this.anim = applyEvents(this.anim, events, this.layout, after, now, {
      context: this.context,
      logLimit: LOG_LIMIT,
      ...(this.instant && INSTANT),
    });
    this.layout = after;
    this.receivedAt = now;
    this.bundles += 1;
    for (const event of events) if (event.type === 'deviation') this.deviations += 1;
  }

  /** Simulation seconds at `now`: the time of the latest state plus what has passed since. */
  simTimeAt(now: number, clock: ClockInput): number {
    const base = this.layout?.time ?? 0;
    if (!clock.playing || clock.speed === null || clock.speed === 'max') return base;
    const ahead = Math.min(Math.max(0, now - this.receivedAt) / 1000, MAX_AHEAD_SECONDS);
    const time = base + ahead * clock.speed;
    return clock.nextEvent !== null ? Math.min(time, Math.max(base, clock.nextEvent)) : time;
  }

  /** True while something moves, flashes or counts, so that the loop must keep drawing. */
  isAnimating(now: number): boolean {
    return isAnimating(this.anim, now);
  }

  /** The dynamic scene of the frame at `now`; drops what has ended. */
  frame(now: number, options: Omit<DynamicOptions, 'now'>): DynamicScene | null {
    const drag = this.drag;
    const context = drag?.context ?? this.context;
    const staticScene = drag?.scene ?? this.staticScene;
    const layout = drag?.layout ?? this.layout;
    if (!context || !staticScene || !layout) return null;
    this.anim = pruneAnimation(this.anim, now);
    const scene = buildDynamicScene(context, staticScene, layout, this.anim, {
      ...options,
      now,
    });
    this.sprites = scene.sprites;
    this.stations = scene.stations;
    return scene;
  }
}

/** The layout state for the editor: the simulated state while simulating, else the initial marking. */
export function layoutStateOfEditor(net: PetriNet): LayoutState {
  return currentSimState() ?? staticLayoutState(net);
}
