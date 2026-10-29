import type { PetriNet } from '@pnm/core';
import {
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  analyzeBehaviour,
  analyzeInvariants,
  analyzeStructure,
  buildCoverabilityGraph,
  buildStateSpace,
  type BehaviourProperties,
  type CoverabilityResult,
  type Invariant,
  type InvariantResult,
  type StateSpace,
  type StructureResult,
} from '@pnm/analysis';

export { DEFAULT_MAX_STATES, DEFAULT_MAX_TIME_MS };

export interface AnalyzeReport {
  structure: StructureResult;
  invariants: InvariantResult;
  space: StateSpace | null;
  behaviour: BehaviourProperties | null;
  coverability: CoverabilityResult | null;
}

/** Runs the analyses that the command prints. */
export async function runAnalysis(
  net: PetriNet,
  options: { states: number; timeMs: number; coverability: boolean; structureOnly: boolean },
): Promise<AnalyzeReport> {
  const structure = analyzeStructure(net);
  const invariants = analyzeInvariants(net);
  if (options.structureOnly) {
    return { structure, invariants, space: null, behaviour: null, coverability: null };
  }
  const space = await buildStateSpace(net, {
    maxStates: options.states,
    maxTimeMs: options.timeMs,
  });
  const behaviour = analyzeBehaviour(net, space);
  const coverability =
    net.profile === 'pt-net' && (options.coverability || space.truncated)
      ? buildCoverabilityGraph(net)
      : null;
  return { structure, invariants, space, behaviour, coverability };
}

/** Names of the elements of a net by id, falling back to the id. */
export function nameLookup(net: PetriNet): (id: string) => string {
  const names = new Map<string, string>();
  for (const node of [...net.places, ...net.transitions]) names.set(node.id, node.name || node.id);
  return (id) => names.get(id) ?? id;
}

/** The result of `pnm analyze --json`, without the name of the file. */
export function analysisJson(net: PetriNet, report: AnalyzeReport): Record<string, unknown> {
  const name = nameLookup(net);
  const { structure, invariants, space, behaviour, coverability } = report;
  const equation = (inv: Invariant): unknown => ({
    equation: inv.equation,
    terms: inv.terms,
    ...(inv.value !== null && { value: inv.value }),
  });
  return {
    net: {
      name: net.name,
      profile: net.profile,
      places: net.places.length,
      transitions: net.transitions.length,
      arcs: net.arcs.length,
    },
    structure: {
      approximate: structure.approximate,
      connected: structure.connected,
      stronglyConnected: structure.stronglyConnected,
      ordinary: structure.ordinary,
      pure: structure.pure,
      stateMachine: structure.stateMachine,
      markedGraph: structure.markedGraph,
      freeChoice: structure.freeChoice,
      extendedFreeChoice: structure.extendedFreeChoice,
      sourcePlaces: structure.sourcePlaces,
      sinkPlaces: structure.sinkPlaces,
      sourceTransitions: structure.sourceTransitions,
      sinkTransitions: structure.sinkTransitions,
      isolated: structure.isolated,
      conflicts: structure.conflicts,
      siphons: structure.siphons,
      traps: structure.traps,
      setsTruncated: structure.setsTruncated,
      commoner: structure.commoner,
      incidence: structure.incidence,
    },
    invariants: {
      approximate: invariants.approximate,
      truncated: invariants.truncated,
      place: invariants.pInvariants.map(equation),
      transition: invariants.tInvariants.map(equation),
      coveredByPInvariants: invariants.coveredByPInvariants,
      coveredByTInvariants: invariants.coveredByTInvariants,
      bounds: invariants.bounds,
    },
    stateSpace:
      space && behaviour
        ? {
            states: behaviour.states,
            edges: behaviour.edges,
            complete: behaviour.complete,
            ...(space.reason !== undefined && { reason: space.reason }),
            bounded: behaviour.bounded,
            bounds: behaviour.bounds,
            deadlockCount: behaviour.deadlockCount,
            deadlockFree: behaviour.deadlockFree,
            deadlocks: behaviour.deadlocks.map((d) => ({
              marking: Object.fromEntries(
                Object.entries(d.marking).map(([id, tokens]) => [name(id), tokens]),
              ),
              trace: d.trace.map((s) => ({
                transition: name(s.transitionId),
                ...(s.binding !== undefined && { binding: s.binding }),
              })),
            })),
            transitions: behaviour.transitions.map((t) => ({
              id: t.transitionId,
              name: t.name,
              liveness: t.liveness,
            })),
            live: behaviour.live,
            reversible: behaviour.reversible,
            homeStates: behaviour.homeStates?.length ?? null,
          }
        : null,
    coverability: coverability
      ? {
          applicable: coverability.applicable,
          bounded: coverability.bounded,
          unboundedPlaces: coverability.unboundedPlaces,
          bounds: coverability.bounds,
          nodes: coverability.nodes.length,
          truncated: coverability.truncated,
        }
      : null,
  };
}
