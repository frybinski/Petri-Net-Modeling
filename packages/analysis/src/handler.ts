import type { PetriNet } from '@pnm/core';
import { checkProperties } from './check';
import { checkLog } from './conformance';
import { buildCoverabilityGraph } from './coverability';
import { analyzeInvariants } from './invariants';
import { analyzeBehaviour } from './properties';
import type {
  AnalysisRequest,
  AnalysisResponse,
  CancelRequest,
  CheckReport,
  Commands,
  StateSpaceReport,
  SpaceLimits,
} from './protocol';
import { AnalysisCancelled, buildStateSpace, type StateSpace } from './state-space';
import { analyzeStructure } from './structure';

/** What the state space depends on: the structure and marking, not names or positions. */
function fingerprint(net: PetriNet, options: SpaceLimits | undefined): string {
  return JSON.stringify([
    net.profile,
    net.types,
    net.places.map((p) => [p.id, p.type, p.capacity]),
    net.transitions.map((t) => [t.id, t.guard]),
    net.arcs.map((a) => [a.source, a.target, a.weight, a.inscription]),
    net.marking,
    options?.maxStates,
    options?.maxTimeMs,
    options?.maxBindings,
  ]);
}

export type Post = (response: AnalysisResponse) => void;

/**
 * Runs the requests of an analysis client. The worker and the in-thread client use the same code.
 * The last state space is kept, so that checking properties right after exploring does not repeat
 * the exploration.
 */
export function createAnalysisHandler(): (
  request: AnalysisRequest | CancelRequest,
  post: Post,
) => Promise<void> {
  const running = new Map<number, AbortController>();
  let cache: { key: string; space: StateSpace } | null = null;

  return async function handle(request, post) {
    if (request.cmd === 'cancel') {
      running.get(request.target)?.abort();
      return;
    }
    const controller = new AbortController();
    running.set(request.id, controller);
    const { signal } = controller;
    try {
      let result: Commands[keyof Commands]['result'];
      switch (request.cmd) {
        case 'structure':
          result = analyzeStructure(request.net, request.options);
          break;
        case 'invariants':
          result = analyzeInvariants(request.net, request.options);
          break;
        case 'coverability':
          result = buildCoverabilityGraph(request.net, { ...request.options, signal });
          break;
        case 'stateSpace': {
          const space = await buildStateSpace(request.net, {
            ...request.options,
            signal,
            onProgress: (progress) => post({ id: request.id, type: 'progress', progress }),
          });
          cache = { key: fingerprint(request.net, request.options), space };
          const report: StateSpaceReport = {
            space,
            behaviour: analyzeBehaviour(request.net, space),
          };
          result = report;
          break;
        }
        case 'check': {
          // The exploration does not depend on the end states; they only matter to the check.
          const spaceOptions: SpaceLimits = request.options ?? {};
          const key = fingerprint(request.net, spaceOptions);
          let space: StateSpace;
          if (cache !== null && cache.key === key) {
            space = cache.space;
          } else {
            space = await buildStateSpace(request.net, {
              ...(spaceOptions.maxStates !== undefined && { maxStates: spaceOptions.maxStates }),
              ...(spaceOptions.maxTimeMs !== undefined && { maxTimeMs: spaceOptions.maxTimeMs }),
              ...(spaceOptions.maxBindings !== undefined && {
                maxBindings: spaceOptions.maxBindings,
              }),
              signal,
              onProgress: (progress) => post({ id: request.id, type: 'progress', progress }),
            });
            cache = { key, space };
          }
          const results = await checkProperties(request.net, space, request.properties, {
            ...(request.options?.final !== undefined && { final: request.options.final }),
            signal,
          });
          const report: CheckReport = {
            results,
            states: space.states.length,
            edges: space.edges.length,
            truncated: space.truncated,
            ...(space.reason !== undefined && { reason: space.reason }),
          };
          result = report;
          break;
        }
        case 'conformance':
          result = checkLog(request.traces, request.properties, request.options);
          break;
      }
      post({ id: request.id, type: 'result', result });
    } catch (error) {
      if (error instanceof AnalysisCancelled) {
        post({ id: request.id, type: 'error', message: error.message, cancelled: true });
      } else {
        post({
          id: request.id,
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      running.delete(request.id);
    }
  };
}
