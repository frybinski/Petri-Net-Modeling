import { hasErrors, parseNet, serializeNet, validate, type PetriNet } from '@pnm/core';
import { toEventLogCsv, toXes } from '@pnm/io';
import {
  DEFAULT_MAX_EVENTS,
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  DEFAULT_SECONDS,
  analysisJson,
  assertSpecsValid,
  checkDomainView,
  checkNet,
  collectSpecs,
  CommandError,
  convertNet,
  domainCheckJson,
  genericView,
  laidOutNet,
  logCheckJson,
  metricsDocument,
  netWithGenericView,
  parseFinalMarkings,
  parseNetInput,
  resolveRates,
  runAnalysis,
  runLogCheck,
  runReplay,
  runSimulation,
  runStateSpaceCheck,
  runToCsv,
  runToEventLines,
  runToXes,
  stateSpaceCheckJson,
  validationJson,
  type LoadedNet,
} from '@pnm/cli/lib';
import type { FinalStates } from '@pnm/analysis';
import { ApiError } from '../errors';
import { DEFAULT_API_MAX_EVENTS, MAX_RETURNED_EVENTS } from './schemas';
import type {
  analyzeRequest,
  checkRequest,
  convertRequest,
  domainCheckRequest,
  domainGenericRequest,
  layoutRequest,
  replayRequest,
  simulateRequest,
  validateRequest,
} from './schemas';
import type { z } from 'zod';

/** The text of the net as the interface takes it: an object (the `.pn.json`) or text (JSON or PNML). */
async function loadNet(input: unknown): Promise<LoadedNet> {
  if (typeof input === 'string') return parseNetInput(input);
  return {
    net: parseNet(input),
    format: 'json',
    importWarnings: [],
    importDiagnostics: [],
    laidOut: false,
  };
}

/** A net with errors cannot be simulated, analysed or replayed; the findings say why. */
function assertUsable(net: PetriNet): void {
  const problems = validate(net);
  if (!hasErrors(problems)) return;
  throw new ApiError(
    422,
    'net_invalid',
    'The net has errors; fix them first (POST /api/v1/validate lists them).',
    {
      details: {
        diagnostics: problems
          .filter((d) => d.severity === 'error')
          .map((d) => ({
            code: d.code,
            message: d.message,
            ...(d.elementId !== undefined && { elementId: d.elementId }),
          })),
      },
    },
  );
}

async function usable(input: unknown): Promise<PetriNet> {
  const { net } = await loadNet(input);
  assertUsable(net);
  return net;
}

type Params<S extends z.ZodType> = z.output<S>;

/** Reads a net from JSON or PNML and returns it as a `.pn.json` object. */
async function parseOp(p: Params<typeof validateRequest>): Promise<unknown> {
  const { net } = await loadNet(p.net);
  return { net: JSON.parse(serializeNet(net)) as unknown };
}

async function validateOp(p: Params<typeof validateRequest>): Promise<unknown> {
  const loaded = await loadNet(p.net);
  return validationJson(loaded, checkNet(loaded.net));
}

async function simulateOp(p: Params<typeof simulateRequest>): Promise<unknown> {
  const net = await usable(p.net);
  const rates =
    p.rates === undefined
      ? {}
      : resolveRates(
          net,
          Object.entries(p.rates).map(([transition, value]) => ({
            transition,
            perHour: value === 'off' ? null : value,
          })),
          'rates',
        );
  const formats = new Set(p.formats ?? []);
  const keep = formats.size > 0;
  const requested = p.maxEvents ?? DEFAULT_API_MAX_EVENTS;
  const run = await runSimulation(net, {
    seconds: p.seconds ?? DEFAULT_SECONDS,
    ...(p.seed !== undefined && { seed: p.seed }),
    ...(p.warmup !== undefined && { warmup: p.warmup }),
    rates,
    maxEvents: keep
      ? Math.min(requested, MAX_RETURNED_EVENTS)
      : Math.min(requested, DEFAULT_MAX_EVENTS),
    keepEvents: keep,
    shortenHint: keep
      ? `shorten the run ("seconds") or leave out "formats" to get the key figures only (a returned log holds at most ${MAX_RETURNED_EVENTS} events).`
      : 'shorten the run ("seconds") or raise "maxEvents".',
  });
  return {
    ...metricsDocument(net, run),
    ...(formats.has('csv') && { csv: runToCsv(net, run, p.startTime) }),
    ...(formats.has('xes') && { xes: runToXes(net, run, p.startTime) }),
    ...(formats.has('stream') && {
      stream: runToEventLines(run)
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as unknown),
    }),
  };
}

async function replayOp(p: Params<typeof replayRequest>): Promise<unknown> {
  const net = await usable(p.net);
  const run = await runReplay(net, p.log, {
    ...(p.map !== undefined && { map: p.map }),
    ...(p.ignore !== undefined && { ignore: p.ignore }),
    ...(p.completeOnly !== undefined && { completeOnly: p.completeOnly }),
    ...(p.timeOrigin !== undefined && { timeOrigin: p.timeOrigin }),
    ...(p.columns !== undefined && { columns: p.columns }),
    ...(p.checkGuards !== undefined && { checkGuards: p.checkGuards }),
    ...(p.seed !== undefined && { seed: p.seed }),
    ...(p.warmup !== undefined && { warmup: p.warmup }),
    label: 'the log',
  });
  const settings = { ...net.simulation, startTime: run.log.origin };
  const formats = new Set(p.formats ?? []);
  return {
    ...run.result,
    logWarnings: run.logWarnings,
    ...(formats.has('csv') && { csv: toEventLogCsv(run.events, net, settings) }),
    ...(formats.has('xes') && { xes: toXes(run.events, net, settings) }),
  };
}

async function analyzeOp(p: Params<typeof analyzeRequest>): Promise<unknown> {
  const net = await usable(p.net);
  const report = await runAnalysis(net, {
    states: p.states ?? DEFAULT_MAX_STATES,
    timeMs: p.timeMs ?? DEFAULT_MAX_TIME_MS,
    coverability: p.coverability === true,
    structureOnly: p.structureOnly === true,
  });
  return analysisJson(net, report);
}

async function checkOp(p: Params<typeof checkRequest>): Promise<unknown> {
  const net = await usable(p.net);
  const { specs, warnings } = collectSpecs(net, p.declare ?? [], p.ltlf ?? []);
  assertSpecsValid(net, specs);
  const extra = warnings.length > 0 ? { warnings } : {};
  if (p.log !== undefined) {
    const run = runLogCheck(net, specs, p.log, {
      includeOpen: p.includeOpen === true,
      label: 'the log',
    });
    return { ...logCheckJson(specs, run), ...extra };
  }
  const final: FinalStates =
    p.final === undefined || p.final === 'deadlock' || p.final === 'all'
      ? (p.final ?? 'deadlock')
      : { markings: parseFinalMarkings(net, p.final, 'final') };
  const run = await runStateSpaceCheck(net, specs, {
    final,
    states: p.states ?? DEFAULT_MAX_STATES,
    timeMs: p.timeMs ?? DEFAULT_MAX_TIME_MS,
  });
  return { ...stateSpaceCheckJson(net, specs, run), ...extra };
}

async function convertOp(p: Params<typeof convertRequest>): Promise<unknown> {
  const { net } = await loadNet(p.net);
  const { net: _net, format, ...options } = p;
  const content = convertNet(net, format, options);
  return { format, name: net.name, content };
}

async function layoutOp(p: Params<typeof layoutRequest>): Promise<unknown> {
  const { net } = await loadNet(p.net);
  const laidOut = await laidOutNet(net, {
    ...(p.direction !== undefined && { direction: p.direction }),
    ...(p.spacing !== undefined && { spacing: p.spacing }),
  });
  return { net: JSON.parse(serializeNet(laidOut)) as unknown };
}

async function domainCheckOp(p: Params<typeof domainCheckRequest>): Promise<unknown> {
  const { net } = await loadNet(p.net);
  const view = p.view ?? net.domainView;
  if (view === undefined) {
    throw new CommandError(
      'The net has no domain view (send one as "view", or create one with POST /api/v1/domain/generic).',
    );
  }
  return domainCheckJson(checkDomainView(net, view));
}

async function domainGenericOp(p: Params<typeof domainGenericRequest>): Promise<unknown> {
  const { net } = await loadNet(p.net);
  const withView = netWithGenericView(net, await genericView(net));
  return { net: JSON.parse(serializeNet(withView)) as unknown };
}

/**
 * The jobs that run in a thread of the pool, by name. Each takes the parameters that the schema of
 * its endpoint has already checked.
 */
export const OPERATIONS = {
  parse: parseOp,
  validate: validateOp,
  simulate: simulateOp,
  replay: replayOp,
  analyze: analyzeOp,
  check: checkOp,
  convert: convertOp,
  layout: layoutOp,
  'domain.check': domainCheckOp,
  'domain.generic': domainGenericOp,
} as const satisfies Record<string, (params: never) => Promise<unknown>>;

export type OperationName = keyof typeof OPERATIONS;

export function isOperation(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}
