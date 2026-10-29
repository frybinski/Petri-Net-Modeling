import type { PetriNet } from '@pnm/core';
import { createSimulation, type SimEvent, type Simulation } from '@pnm/sim';
import {
  applyEvents,
  EMPTY_ANIMATION,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  type AnimationOptions,
  type AnimationState,
  type DomainView,
  type TokenLayout,
} from '../src';

export interface RunResult {
  events: SimEvent[];
  anim: AnimationState;
  layout: TokenLayout;
  /** Every motion that was started, in order (the animation state only keeps the live ones). */
  motions: AnimationState['motions'];
}

export interface RunOptions {
  /** Simulation seconds per bundle. */
  bundle: number;
  /** Total simulation seconds. */
  seconds: number;
  /** Wall-clock milliseconds between bundles. */
  wallStep?: number;
  animation?: Omit<AnimationOptions, 'context'>;
  seed?: number;
  /** The simulation to run instead of the engine, for example a replay of an event log. */
  simulation?: (net: PetriNet) => Simulation;
  /** Called after every bundle. */
  onBundle?: (bundle: SimEvent[], anim: AnimationState, layout: TokenLayout, now: number) => void;
}

/**
 * Runs a simulation and feeds every bundle of events through layout and animation, the way the
 * app does. Returns the whole event stream and the final state.
 */
export async function runAnimated(
  net: PetriNet,
  view: DomainView,
  options: RunOptions,
): Promise<RunResult> {
  const sim =
    options.simulation?.(net) ??
    createSimulation(net, options.seed === undefined ? {} : { seed: options.seed });
  const context = layoutContext(net, view);
  const animation: AnimationOptions = {
    context,
    logLimit: Infinity,
    ...options.animation,
  };
  let layout = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
  let anim = EMPTY_ANIMATION;
  const events: SimEvent[] = [];
  const motions: AnimationState['motions'] = [];
  let now = 0;
  const wallStep = options.wallStep ?? 40;
  const first = [...sim.initialEvents];
  const process = (bundle: SimEvent[]): void => {
    const next = layoutTokens(net, view, layoutStateOf(sim.state));
    anim = applyEvents(anim, bundle, layout, next, now, animation);
    for (const motion of anim.motions) {
      if (!motions.includes(motion)) motions.push(motion);
    }
    layout = next;
    events.push(...bundle);
    options.onBundle?.(bundle, anim, layout, now);
    now += wallStep;
  };
  process(first);
  for (let t = 0; t < options.seconds; t += options.bundle) {
    process(await sim.advance(options.bundle));
  }
  return { events, anim, layout, motions };
}
