import type { Id, PetriNet } from '@pnm/core';
import {
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  EMPTY_ANIMATION,
  INSTANT,
  isAnimating,
  layoutContext,
  layoutTokens,
  pruneAnimation,
  staticLayoutState,
  type AnimationState,
  type DomainView,
  type DynamicOptions,
  type DynamicScene,
  type LayoutContext,
  type LayoutState,
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
  staticScene: Scene | null = null;
  layout: TokenLayout | null = null;
  anim: AnimationState = EMPTY_ANIMATION;
  /** Wall-clock time at which the latest bundle arrived. */
  receivedAt = 0;
  /** The sprites and station states of the latest frame, for hit tests and the hover card. */
  sprites: readonly SpriteSample[] = [];
  stations: ReadonlyMap<Id, StationInfo> = new Map();
  private instant = false;
  /** Bundles processed since the model was set, for the tests and the status of the canvas. */
  bundles = 0;

  /** Sets the net and its view (or `null` if there is none to draw) and snaps to the state. */
  setModel(net: PetriNet, view: DomainView | null, state: LayoutState): void {
    this.net = net;
    this.view = view;
    if (view) {
      this.context = layoutContext(net, view);
      this.staticScene = buildStaticScene(net, view);
    } else {
      this.context = null;
      this.staticScene = null;
    }
    this.snap(state);
  }

  /** All tokens jump to the layout of `state`; running motions end. */
  snap(state: LayoutState): void {
    this.anim = EMPTY_ANIMATION;
    this.layout = this.net && this.view ? layoutTokens(this.net, this.view, state) : null;
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
    if (!this.context || !this.staticScene || !this.layout) return null;
    this.anim = pruneAnimation(this.anim, now);
    const scene = buildDynamicScene(this.context, this.staticScene, this.layout, this.anim, {
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
