export * from './types';
export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_MS,
  ExpressionFailure,
  cacheSize,
  clearCache,
  compile,
  evaluateGuard,
  evaluateOutput,
  parseInputInscription,
  referencedVariables,
  tryCompile,
} from './expression';
export { BUILTIN_NAMES, FUNCTIONS, type FunctionInfo } from './functions';
