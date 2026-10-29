/**
 * The functions behind the commands of `pnm`, without the command line: they take a net and
 * options and return data. The server (`@pnm/server`) answers its HTTP interface with the same
 * functions, so a result is the same whether it comes from `pnm` or from the server.
 */
export { CommandError, UsageError } from '../errors';
export { detectFormat, parseNetInput, type LoadedNet, type NetFormat } from './net-text';
export { checkNet, validationJson, type NetCheck } from './validate';
export {
  DEFAULT_MAX_EVENTS,
  DEFAULT_SECONDS,
  logRowCount,
  metricsDocument,
  resolveRates,
  runSimulation,
  runToCsv,
  runToEventLines,
  runToXes,
  type SimulateRequest,
  type SimulateRun,
} from './simulate';
export {
  groupDeviations,
  runReplay,
  type Deviation,
  type DeviationGroup,
  type ReplayRequest,
  type ReplayResult,
  type ReplayRun,
} from './replay';
export {
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  analysisJson,
  nameLookup,
  runAnalysis,
  type AnalyzeReport,
} from './analysis';
export {
  assertSpecsValid,
  collectSpecs,
  finalName,
  logCheckJson,
  parseFinalMarkings,
  runLogCheck,
  runStateSpaceCheck,
  stateSpaceCheckJson,
  type LogCheck,
  type StateSpaceCheck,
} from './check';
export { convertNet, type ConvertFormat, type ConvertOptions } from './convert';
export { laidOutNet, type LayoutSettings } from './layout';
export {
  checkDomainView,
  domainCheckJson,
  genericView,
  netWithGenericView,
  type DomainCheck,
} from './domain';
