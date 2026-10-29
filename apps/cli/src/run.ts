import { UsageError, CommandError, messageOf } from './errors';
import type { Io } from './io';
import { ANALYZE_HELP, analyzeCommand } from './commands/analyze';
import { CHECK_HELP, checkCommand } from './commands/check';
import { DOMAIN_HELP, domainCommand } from './commands/domain';
import { EXAMPLES_HELP, examplesCommand } from './commands/examples';
import { EXPORT_HELP, exportCommand } from './commands/export';
import { IMPORT_HELP, importCommand } from './commands/import';
import { LAYOUT_HELP, layoutCommand } from './commands/layout';
import { SIMULATE_HELP, simulateCommand } from './commands/simulate';
import { VALIDATE_HELP, validateCommand } from './commands/validate';

export const VERSION = __PNM_VERSION__;

const MAIN_HELP = `pnm ${VERSION}: command line for Petri nets

Usage: pnm <command> [arguments]

Commands:
  validate <net>             check a net and its domain view
  simulate <net>             run the timed simulation, print key figures, write event logs
  analyze <net>              structure, invariants, state space, boundedness, deadlocks, liveness
  check <net>                check DECLARE and LTLf properties on the state space or an event log
  export <net> --format <f>  write svg, pnml, tikz or json (png: web app only)
  import <file.pnml>         read PNML and write .pn.json
  layout <net>               compute a new automatic layout
  domain check|generic|generate <net>
                             check, create or generate the domain view
  examples list|copy         the example nets

A <net> is a .pn.json or PNML file; - reads standard input.
Run "pnm <command> --help" for the options of a command.

Exit status: 0 success, 1 the command failed (errors in the net, unreadable file, a violated property),
2 wrong usage.
`;

const HELP: Record<string, string> = {
  validate: VALIDATE_HELP,
  simulate: SIMULATE_HELP,
  analyze: ANALYZE_HELP,
  check: CHECK_HELP,
  export: EXPORT_HELP,
  import: IMPORT_HELP,
  layout: LAYOUT_HELP,
  domain: DOMAIN_HELP,
  examples: EXAMPLES_HELP,
};

type Handler = (io: Io, args: readonly string[]) => Promise<number>;

const COMMANDS: Record<string, Handler> = {
  validate: validateCommand,
  simulate: simulateCommand,
  analyze: analyzeCommand,
  check: checkCommand,
  export: exportCommand,
  import: importCommand,
  layout: layoutCommand,
  domain: domainCommand,
  examples: examplesCommand,
};

/**
 * Runs the command line and returns the exit status: 0 success, 1 the command failed, 2 wrong
 * usage. Nothing is thrown for problems of the input; they are printed to standard error.
 */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined) {
      io.err(MAIN_HELP);
      return 2;
    }
    if (command === '--help' || command === '-h' || command === 'help') {
      const topic = command === 'help' ? rest[0] : undefined;
      io.out(topic !== undefined && HELP[topic] !== undefined ? HELP[topic] : MAIN_HELP);
      return 0;
    }
    if (command === '--version' || command === '-v' || command === 'version') {
      io.out(`${VERSION}\n`);
      return 0;
    }
    const handler = COMMANDS[command];
    if (!handler) throw new UsageError(`Unknown command "${command}".`);
    if (rest.includes('--help') || rest.includes('-h')) {
      // `domain` and `examples` have sub commands and show their own help.
      io.out(HELP[command] ?? MAIN_HELP);
      return 0;
    }
    return await handler(io, rest);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(
        `pnm: ${error.message}\nRun "pnm${command !== undefined && COMMANDS[command] ? ` ${command}` : ''} --help" for usage.\n`,
      );
      return 2;
    }
    if (error instanceof CommandError) {
      io.err(`pnm: ${error.message}\n`);
      return 1;
    }
    io.err(`pnm: unexpected error: ${messageOf(error)}\n`);
    return 1;
  }
}
