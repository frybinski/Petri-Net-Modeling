import type { PetriNet } from '@pnm/core';
import { genericDomainViewWithLayout, type DomainDiagnostic } from '@pnm/domain';
import { numberOption, choiceOption, parseCommandArgs, requireOne } from '../args';
import { CommandError, UsageError, messageOf } from '../errors';
import { makeStyle, plural, table } from '../format';
import type { Io } from '../io';
import { checkDomainView, domainCheckJson, netWithGenericView } from '../lib/domain';
import { describeNet, formatOfName, loadNet, reportImportWarnings, serialize } from '../net-file';

export const DOMAIN_HELP = `Usage: pnm domain <check|generic|generate> <net> [options]

The domain view draws a net as a real place (a hall, an office) with stations, belts and queues.

  pnm domain check <net> [--view <file>] [--json]
      Checks the rules V1 to V9 for the domain view in the net, or for the view in a JSON file.
      Exit status 1 if there are errors (warnings are fine) or no view.

  pnm domain generic <net> [-o <file>] [--view-only]
      Adds a generic domain view (stations where the net has its nodes). Writes the net with the
      view; with --view-only only the view as JSON.

  pnm domain generate <net> --description "<text>" [options] [-o <file>]
      Lets a language model make the view, from your description, with the repair loop of the web
      app. Needs an OpenAI-compatible server.
        --description <text>  what the process is and where it happens (required)
        --base-url <url>      server up to /v1, e.g. http://localhost:11434/v1 (or PNM_LLM_BASE_URL)
        --model <name>        model name (or PNM_LLM_MODEL)
        --api-key <key>       API key (or PNM_LLM_API_KEY); never printed or written to a file
        --json-mode <m>       auto (default), schema, object or none
        --temperature <n>     default 0.2
        --rounds <n>          requests per net at most, default 3
        --timeout <s>         seconds per request, default 120
        --width <n> --height <n>   canvas size, default as the generic view chooses
        --quiet, -q           no progress on standard error

Without -o the net goes to standard output; a name ending in .pnml writes PNML.
`;

function ruleTable(diagnostics: readonly DomainDiagnostic[], io: Io): string {
  const style = makeStyle(io.color);
  return table(
    [{ header: 'SEVERITY' }, { header: 'RULE' }, { header: 'PATH' }, { header: 'MESSAGE' }],
    diagnostics.map((d) => [
      d.severity === 'error' ? style.red('error') : style.yellow('warning'),
      d.rule,
      d.path,
      d.message,
    ]),
  );
}

async function check(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    view: { type: 'string' },
    json: { type: 'boolean' },
  });
  const path = requireOne(positionals, 'net file');
  const loaded = await loadNet(io, path);
  reportImportWarnings(io, path, loaded);
  const { net } = loaded;

  let view: unknown = net.domainView;
  if (values.view !== undefined) {
    try {
      view = JSON.parse(await io.readText(values.view));
    } catch (error) {
      throw new CommandError(`${values.view}: cannot be read as JSON (${messageOf(error)})`);
    }
  }
  if (view === undefined) {
    throw new CommandError(
      `${path}: the net has no domain view (use --view <file>, or pnm domain generic).`,
    );
  }
  const result = checkDomainView(net, view);
  const { errors, warnings } = result;
  if (values.json === true) {
    io.out(`${JSON.stringify({ file: path, ...domainCheckJson(result) }, null, 2)}\n`);
  } else {
    const style = makeStyle(io.color);
    io.out(
      `${path}: domain view ${result.ok ? style.green('ok') : style.red('has errors')} ` +
        `(${plural(errors, 'error')}, ${plural(warnings, 'warning')})\n`,
    );
    if (result.diagnostics.length > 0) io.out(ruleTable(result.diagnostics, io));
  }
  return result.ok ? 0 : 1;
}

async function writeNet(io: Io, net: PetriNet, output: string): Promise<void> {
  await io.writeText(output, serialize(net, formatOfName(output)));
}

async function generic(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    output: { type: 'string', short: 'o' },
    'view-only': { type: 'boolean' },
  });
  const path = requireOne(positionals, 'net file');
  const loaded = await loadNet(io, path);
  reportImportWarnings(io, path, loaded);
  const { net } = loaded;
  const view = await genericDomainViewWithLayout(net);
  const output = values.output ?? '-';
  if (values['view-only'] === true) {
    await io.writeText(output, `${JSON.stringify(view, null, 2)}\n`);
  } else {
    // A view that was written by a model no longer describes this one.
    await writeNet(io, netWithGenericView(net, view), output);
  }
  io.err(
    `${path}: generic domain view for ${describeNet(net)}${output !== '-' ? `; wrote ${output}` : ''}\n`,
  );
  return 0;
}

async function generate(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    description: { type: 'string' },
    'base-url': { type: 'string' },
    model: { type: 'string' },
    'api-key': { type: 'string' },
    'json-mode': { type: 'string' },
    temperature: { type: 'string' },
    rounds: { type: 'string' },
    timeout: { type: 'string' },
    width: { type: 'string' },
    height: { type: 'string' },
    output: { type: 'string', short: 'o' },
    quiet: { type: 'boolean', short: 'q' },
  });
  const path = requireOne(positionals, 'net file');
  const description = values.description?.trim();
  if (description === undefined || description === '') {
    throw new UsageError(
      '--description is required: say what the process is and where it happens.',
    );
  }
  const baseUrl = values['base-url'] ?? io.env['PNM_LLM_BASE_URL'];
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new UsageError(
      '--base-url is required (or set PNM_LLM_BASE_URL), e.g. http://localhost:11434/v1',
    );
  }
  const model = values.model ?? io.env['PNM_LLM_MODEL'];
  if (model === undefined || model.trim() === '') {
    throw new UsageError('--model is required (or set PNM_LLM_MODEL).');
  }
  const apiKey = values['api-key'] ?? io.env['PNM_LLM_API_KEY'];
  const jsonMode = choiceOption(values['json-mode'], 'json-mode', [
    'auto',
    'schema',
    'object',
    'none',
  ] as const);
  const temperature = numberOption(
    values.temperature,
    'temperature',
    (n) => n >= 0 && n <= 2,
    'a number from 0 to 2',
  );
  const rounds = numberOption(
    values.rounds,
    'rounds',
    (n) => Number.isInteger(n) && n >= 1 && n <= 10,
    'an integer from 1 to 10',
  );
  const timeout = numberOption(values.timeout, 'timeout', (n) => n > 0, 'a number above 0');
  const width = numberOption(values.width, 'width', (n) => n >= 200, 'a number of at least 200');
  const height = numberOption(values.height, 'height', (n) => n >= 200, 'a number of at least 200');

  const loaded = await loadNet(io, path);
  reportImportWarnings(io, path, loaded);
  const { net } = loaded;

  const { createProvider, errorMessage, generateDomainView, toGenerationRecord } =
    await import('@pnm/llm');
  const provider = createProvider({
    baseUrl,
    model,
    ...(apiKey !== undefined && apiKey !== '' && { apiKey }),
    ...(temperature !== undefined && { temperature }),
    ...(jsonMode !== undefined && { jsonMode }),
    ...(timeout !== undefined && { timeoutMs: timeout * 1000 }),
    ...(io.fetch !== undefined && { fetch: io.fetch }),
  });
  const quiet = values.quiet === true;
  let result;
  try {
    result = await generateDomainView(net, provider, {
      description,
      ...(width !== undefined && height !== undefined && { canvas: { width, height } }),
      ...(rounds !== undefined && { maxRounds: rounds }),
      onProgress: (progress) => {
        if (quiet) return;
        const errors = progress.diagnostics?.filter((d) => d.severity === 'error').length;
        io.err(
          `round ${progress.round}: ${progress.phase}` +
            (errors !== undefined ? ` (${plural(errors, 'error')})` : '') +
            '\n',
        );
      },
    });
  } catch (error) {
    throw new CommandError(`The language model could not be used: ${errorMessage(error)}`);
  }
  const record = toGenerationRecord(result, { description, baseUrl });
  const output = values.output ?? '-';
  await writeNet(io, { ...net, domainView: result.view, domainViewGeneration: record }, output);

  for (const note of result.notes) io.err(`note: ${note}\n`);
  const kept = result.fellBack
    ? 'the answer of the model was not usable, so the generic view was used'
    : `${plural(result.filled.length, 'entry', 'entries')} filled in generically, ${plural(result.dropped.length, 'entry', 'entries')} dropped`;
  io.err(
    `${path}: domain view by ${result.model} in ${plural(result.rounds.length, 'round')}; ${kept}` +
      `${output !== '-' ? `; wrote ${output}` : ''}\n`,
  );
  return 0;
}

export async function domainCommand(io: Io, args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined) {
    io.err(DOMAIN_HELP);
    return 2;
  }
  if (sub === '--help' || sub === '-h') {
    io.out(DOMAIN_HELP);
    return 0;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(DOMAIN_HELP);
    return 0;
  }
  switch (sub) {
    case 'check':
      return check(io, rest);
    case 'generic':
      return generic(io, rest);
    case 'generate':
      return generate(io, rest);
    default:
      throw new UsageError(`Unknown domain command "${sub}" (check, generic, generate).`);
  }
}
