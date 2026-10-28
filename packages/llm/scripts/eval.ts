import { join } from 'node:path';
import { HELP, parseArgs, repositoryRoot, runEval } from './eval-lib';

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Run with --help for the options.');
    return 64;
  }
  if (parsed.help) {
    console.log(HELP);
    return 0;
  }
  const root = repositoryRoot();
  const outcome = await runEval({
    ...parsed.options,
    examplesDir: join(root, 'examples'),
    outDir: parsed.options.outDir ?? join(root, 'docs', 'eval'),
    log: (line) => {
      console.log(line);
    },
  });
  console.log('\nNet                 Result    Rounds  Errors per round');
  for (const row of outcome.rows) {
    const result = row.error ? 'ERROR' : row.passed ? 'PASS' : row.fellBack ? 'FALLBACK' : 'FILLED';
    console.log(
      `${row.netName.padEnd(20)}${result.padEnd(10)}${String(row.rounds).padEnd(8)}${row.errorsPerRound.join(' -> ')}`,
    );
  }
  if (outcome.rows.some((row) => row.error)) return 1;
  if (parsed.strict && outcome.rows.some((row) => !row.passed)) return 2;
  return 0;
}

process.exitCode = await main();
