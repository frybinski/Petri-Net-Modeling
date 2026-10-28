import { createSimulation, isTimedNet } from './engine';
import type { EnabledEntry, Request, Response, SimView } from './protocol';
import type { SimEvent, Simulation } from './types';

/**
 * Executes the commands of the protocol against one simulation. Requests are processed one after
 * the other, in the order in which they arrive, whether they come from a worker or from the same
 * thread.
 */
export function createHandler(): (request: Request) => Promise<Response> {
  let sim: Simulation | null = null;
  let timed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const need = (): Simulation => {
    if (!sim) throw new Error('The simulation has not been initialised');
    return sim;
  };

  async function view(simulation: Simulation, withEnabled: boolean): Promise<SimView> {
    let enabled: EnabledEntry[] | null = null;
    let diagnostics: SimView['diagnostics'] = [];
    if (withEnabled) {
      const result = await simulation.enabled();
      enabled = [...result.enabled].map(([transitionId, found]) => ({
        transitionId,
        bindings: found.bindings,
        truncated: found.truncated,
      }));
      diagnostics = result.diagnostics;
    }
    const state = simulation.state;
    return {
      time: state.time,
      marking: state.marking,
      running: state.running.map((f) => ({
        firingId: f.id,
        transitionId: f.transitionId,
        start: f.start,
        end: f.end,
        slot: f.slot,
        caseIds: f.caseIds,
      })),
      enabled,
      diagnostics,
      nextEventTime: simulation.nextEventTime(),
      rates: simulation.rates(),
      metrics: simulation.metrics(),
      canStepBack: simulation.canStepBack(),
      eventCount: state.counters.event,
      firingCount: state.counters.firing,
      timed,
    };
  }

  async function execute(request: Request): Promise<Response> {
    const { id } = request;
    try {
      let events: SimEvent[] = [];
      switch (request.cmd) {
        case 'init': {
          sim = createSimulation(request.net, request.options);
          timed = isTimedNet(request.net);
          events = [...sim.initialEvents];
          break;
        }
        case 'step':
          events = await need().step();
          break;
        case 'stepRandom': {
          const count = Math.max(1, request.count ?? 1);
          for (let i = 0; i < count; i += 1) {
            const batch = await need().stepRandom();
            events.push(...batch);
            if (batch.some((e) => e.type === 'idle')) break;
          }
          break;
        }
        case 'advance':
          events = await need().advance(
            request.seconds,
            request.maxEvents === undefined ? {} : { maxEvents: request.maxEvents },
          );
          break;
        case 'fire':
          events = await need().fireManually(request.transitionId, request.binding);
          break;
        case 'edit':
          events = await need().editMarking(request.placeId, request.tokens);
          break;
        case 'adjust': {
          const simulation = need();
          const tokens = [...(simulation.state.marking[request.placeId] ?? [])];
          if (request.delta > 0) tokens.push(structuredClone(request.sample ?? tokens.at(-1) ?? 1));
          else tokens.pop();
          events = await simulation.editMarking(request.placeId, tokens);
          break;
        }
        case 'setRate':
          await need().setRate(request.transitionId, request.perHour);
          break;
        case 'setBreakpoints':
          need().setBreakpoints(request.breakpoints);
          break;
        case 'back':
          await need().stepBack();
          break;
        case 'reset':
          events = await need().reset(request.seed);
          break;
        case 'snapshot':
          return { id, type: 'snapshot', snapshot: need().snapshot() };
        case 'restore':
          await need().restore(request.snapshot);
          break;
        case 'view':
          break;
      }
      return { id, type: 'result', events, view: await view(need(), request.enabled !== false) };
    } catch (error) {
      return { id, type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  return (request) => {
    const result = queue.then(() => execute(request));
    queue = result;
    return result;
  };
}
