import { createInterface } from 'node:readline';
import { createApp } from './app';
import { hashPassword } from './basic-auth';
import { ConfigError, describeConfig, loadConfig } from './config';
import { describeError, messageOf } from './errors';
import { createLogger } from './logger';
import { VERSION } from './version';

const USAGE = `Petri Net Modeling server ${VERSION}

Usage: node server.js [command]

  (no command)          start the server; it is configured by PNM_* environment variables
  check-config          read the environment, print the settings without secrets, exit
  hash-password <user>  read a password from standard input and print an entry for PNM_BASIC_AUTH
  --version             print the version

See docs/server.md and deploy/README.md for the variables.
`;

async function readPassword(): Promise<string> {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return '';
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'hash-password') {
    const user = rest[0];
    if (user === undefined) {
      process.stderr.write(
        'Usage: node server.js hash-password <user>   (the password on standard input)\n',
      );
      return 2;
    }
    try {
      process.stdout.write(`${hashPassword(user, await readPassword())}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${messageOf(error)}\n`);
      return 1;
    }
  }
  if (command !== undefined && command !== 'check-config') {
    process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 78;
    }
    throw error;
  }
  if (command === 'check-config') {
    process.stdout.write(`${JSON.stringify(describeConfig(config), null, 2)}\n`);
    return 0;
  }

  const logger = createLogger();
  // A bug that nobody caught ends the process (the container is restarted); the log says what.
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      logger.error(event, { error: describeError(error) });
      process.exit(1);
    });
  }
  let app;
  let port: number;
  try {
    app = await createApp(config, { logger });
    port = await app.start();
  } catch (error) {
    logger.error('cannot start', { error: messageOf(error) });
    return 1;
  }
  logger.info('listening', { version: VERSION, port, publicUrl: config.publicUrl });

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      logger.info('stopping', { signal });
      void app.close(10_000).then(resolve);
    };
    process.on('SIGTERM', () => {
      stop('SIGTERM');
    });
    process.on('SIGINT', () => {
      stop('SIGINT');
    });
  });
  logger.info('stopped');
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
