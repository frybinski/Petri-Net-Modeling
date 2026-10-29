import { hasErrors, validate, type PetriNet } from '@pnm/core';
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
  type Step,
} from '@pnm/analysis';
import { numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError } from '../errors';
import { makeStyle, plural, table } from '../format';
import type { Io } from '../io';
import { loadNet, reportImportWarnings } from '../net-file';

export const ANALYZE_HELP = `Usage: pnm analyze <net> [options]

Analyses a net: structure (connectedness, state machine, marked graph, free choice, siphons and
traps), place and transition invariants, and the state space (boundedness, deadlocks, liveness,
reversibility). Place/transition nets also get the coverability graph when the state space is cut
off. JSON nets are analysed with the atomic firing rule, one edge per binding.

  --states <n>        maximum number of states, default ${DEFAULT_MAX_STATES}
  --time <ms>         maximum time for the state space, default ${DEFAULT_MAX_TIME_MS}
  --coverability      always compute the coverability graph (place/transition nets)
  --structure-only    only structure and invariants, no state space
  --json              print the result as JSON
  --help

Exit status: 0 the analysis ran, 1 the net has errors or cannot be read, 2 wrong usage.
`;

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

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

/** Names of the elements of a net by id, falling back to the id. */
function nameLookup(net: PetriNet): (id: string) => string {
  const names = new Map<string, string>();
  for (const node of [...net.places, ...net.transitions]) names.set(node.id, node.name || node.id);
  return (id) => names.get(id) ?? id;
}

function describeTrace(steps: readonly Step[], name: (id: string) => string): string {
  if (steps.length === 0) return 'no step';
  return steps
    .map((s) => {
      const binding = s.binding !== undefined && Object.keys(s.binding).length > 0;
      return binding
        ? `${name(s.transitionId)} ${JSON.stringify(s.binding)}`
        : name(s.transitionId);
    })
    .join(' -> ');
}

function describeMarking(
  marking: Record<string, readonly unknown[]>,
  name: (id: string) => string,
): string {
  const parts = Object.entries(marking)
    .filter(([, tokens]) => tokens.length > 0)
    .map(([id, tokens]) => `${name(id)}${tokens.length > 1 ? ` x${tokens.length}` : ''}`);
  return parts.length === 0 ? '(empty)' : parts.join(', ');
}

function invariantLines(list: Invariant[]): string[] {
  return list.map((inv) => `  ${inv.equation}`);
}

function textReport(net: PetriNet, report: AnalyzeReport, io: Io): string {
  const style = makeStyle(io.color);
  const name = nameLookup(net);
  const lines: string[] = [];
  const heading = (text: string): void => {
    lines.push('', style.bold(text));
  };
  lines.push(
    style.bold(
      `${net.name} (${plural(net.places.length, 'place')}, ${plural(net.transitions.length, 'transition')}, ${plural(net.arcs.length, 'arc')}, ${net.profile})`,
    ),
  );

  const { structure, invariants, space, behaviour, coverability } = report;
  heading('Structure');
  if (structure.approximate) {
    lines.push(
      '  JSON net: computed on the place/transition skeleton (arc weights, no inscriptions).',
    );
  }
  lines.push(
    table(
      [{ header: 'PROPERTY' }, { header: '' }, { header: 'REASON' }],
      structure.checks.map((c) => [c.label, c.holds ? style.green('yes') : 'no', c.explanation]),
    ).trimEnd(),
  );
  const listing = (label: string, ids: string[]): void => {
    if (ids.length > 0) lines.push(`  ${label}: ${ids.map(name).join(', ')}`);
  };
  listing('source places', structure.sourcePlaces);
  listing('sink places', structure.sinkPlaces);
  listing('source transitions', structure.sourceTransitions);
  listing('sink transitions', structure.sinkTransitions);
  listing('isolated elements', structure.isolated);
  if (structure.conflicts.length > 0) {
    lines.push(
      `  conflicts: ${structure.conflicts.map((c) => `${name(c.placeId)} -> ${c.transitionIds.map(name).join(' | ')}`).join('; ')}`,
    );
  }
  lines.push(
    `  minimal siphons: ${structure.siphons.length}, minimal traps: ${structure.traps.length}${structure.setsTruncated ? ' (cut off)' : ''}`,
  );
  if (structure.commoner) {
    lines.push(
      `  Commoner's condition (every siphon contains a marked trap): ${yesNo(structure.commoner.holds)}` +
        (structure.freeChoice ? ' (free choice: equivalent to liveness)' : ''),
    );
  }

  heading('Place invariants (y.C = 0)');
  if (invariants.approximate) lines.push('  JSON net: computed on the skeleton.');
  lines.push(
    ...(invariants.pInvariants.length > 0 ? invariantLines(invariants.pInvariants) : ['  none']),
  );
  lines.push(
    `  covered by place invariants (hence bounded): ${yesNo(invariants.coveredByPInvariants)}`,
  );
  heading('Transition invariants (C.x = 0)');
  lines.push(
    ...(invariants.tInvariants.length > 0 ? invariantLines(invariants.tInvariants) : ['  none']),
  );
  lines.push(
    `  every transition in a transition invariant (needed for live and bounded): ${yesNo(invariants.coveredByTInvariants)}`,
  );
  if (invariants.truncated) lines.push('  (cut off at the limit; the lists are incomplete)');

  if (space && behaviour) {
    heading('State space');
    lines.push(
      `  ${plural(behaviour.states, 'state')}, ${plural(behaviour.edges, 'edge')}` +
        (space.truncated ? style.yellow(` (cut off: ${space.reason ?? 'limit'})`) : ' (complete)'),
    );
    const bounded =
      behaviour.bounded === true
        ? `yes, at most ${plural(behaviour.maxPlaceTokens, 'token')} on a place`
        : coverability && coverability.bounded !== null
          ? coverability.bounded
            ? 'yes (coverability graph)'
            : `no, unbounded: ${coverability.unboundedPlaces.map(name).join(', ')}`
          : 'unknown (state space cut off)';
    lines.push(`  bounded: ${bounded}`);
    lines.push(
      table(
        [{ header: 'PLACE' }, { header: 'MAX', align: 'right' }],
        net.places.map((p) => {
          const omega = coverability?.bounds[p.id] === 'ω';
          return [p.name || p.id, omega ? 'ω' : String(behaviour.bounds[p.id] ?? 0)];
        }),
      )
        .trimEnd()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
    if (behaviour.deadlockCount === 0) {
      lines.push(
        `  deadlocks: ${behaviour.deadlockFree === true ? 'none' : 'none found (state space incomplete)'}`,
      );
    } else {
      lines.push(`  deadlocks: ${behaviour.deadlockCount}`);
      for (const witness of behaviour.deadlocks.slice(0, 3)) {
        lines.push(
          `    after ${plural(witness.trace.length, 'step')}: ${describeTrace(witness.trace, name)}`,
          `    marking: ${describeMarking(witness.marking, name)}`,
        );
      }
    }
    lines.push(`  live: ${yesNo(behaviour.live)}`);
    lines.push(
      table(
        [{ header: 'TRANSITION' }, { header: 'LIVENESS' }],
        behaviour.transitions.map((t) => [t.name || t.transitionId, t.liveness]),
      )
        .trimEnd()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
    lines.push('  (dead: never enabled, L1: enabled somewhere, L3: on a cycle, L4: live)');
    lines.push(`  reversible: ${yesNo(behaviour.reversible)}`);
    if (behaviour.homeStates !== null) {
      lines.push(`  home markings: ${behaviour.homeStates.length}`);
    }
  }
  if (coverability && coverability.applicable) {
    heading('Coverability graph');
    lines.push(
      `  ${plural(coverability.nodes.length, 'node')}${coverability.truncated ? ' (cut off)' : ''}, bounded: ${yesNo(coverability.bounded)}`,
    );
    if (coverability.unboundedPlaces.length > 0) {
      lines.push(`  unbounded places (ω): ${coverability.unboundedPlaces.map(name).join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function jsonReport(net: PetriNet, path: string, report: AnalyzeReport): unknown {
  const name = nameLookup(net);
  const { structure, invariants, space, behaviour, coverability } = report;
  const equation = (inv: Invariant): unknown => ({
    equation: inv.equation,
    terms: inv.terms,
    ...(inv.value !== null && { value: inv.value }),
  });
  return {
    file: path,
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

export async function analyzeCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    states: { type: 'string' },
    time: { type: 'string' },
    coverability: { type: 'boolean' },
    'structure-only': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  const path = requireOne(positionals, 'net file');
  const states =
    numberOption(
      values.states,
      'states',
      (n) => Number.isInteger(n) && n > 0,
      'a positive integer',
    ) ?? DEFAULT_MAX_STATES;
  const timeMs =
    numberOption(values.time, 'time', (n) => n > 0, 'a number of milliseconds above 0') ??
    DEFAULT_MAX_TIME_MS;

  const loaded = await loadNet(io, path);
  const { net } = loaded;
  reportImportWarnings(io, path, loaded);
  const problems = validate(net);
  if (hasErrors(problems)) {
    for (const d of problems.filter((p) => p.severity === 'error')) {
      io.err(
        `${path}: error: ${d.message}${d.elementId !== undefined ? ` (${d.elementId})` : ''}\n`,
      );
    }
    throw new CommandError(
      `${path}: the net has errors; fix them before analysing (pnm validate).`,
    );
  }
  const report = await runAnalysis(net, {
    states,
    timeMs,
    coverability: values.coverability === true,
    structureOnly: values['structure-only'] === true,
  });
  if (values.json === true) io.out(`${JSON.stringify(jsonReport(net, path, report), null, 2)}\n`);
  else io.out(textReport(net, report, io));
  return 0;
}
