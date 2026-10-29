import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseNetText, serializeNet, validate, type PetriNet } from '@pnm/core';
import { netToSvg, toEventLogCsv, toPnml, toTikz, toXes } from '@pnm/io';
import { createSimulation, type SimEvent } from '@pnm/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE, REPO, example, fixture, pnm, tempDir } from './helpers';

let scratch: ReturnType<typeof tempDir>;
beforeAll(() => {
  scratch = tempDir();
});
afterAll(() => {
  scratch.cleanup();
});
const tmp = (name: string): string => join(scratch.dir, name);

function load(path: string): PetriNet {
  return parseNetText(readFileSync(path, 'utf8'));
}

/** The events the web app's engine produces for a run of `seconds`, in chunks of any size. */
async function referenceEvents(net: PetriNet, seed: number, seconds: number): Promise<SimEvent[]> {
  const sim = createSimulation(net, { seed });
  const events: SimEvent[] = [...sim.initialEvents];
  while (sim.state.time < seconds) {
    events.push(...(await sim.advance(Math.min(137, seconds - sim.state.time))));
  }
  return events;
}

describe('the bundle', () => {
  it('exists and starts with a shebang', () => {
    expect(readFileSync(BUNDLE, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('runs on its own, without node_modules next to it', async () => {
    const lonely = join(scratch.dir, 'lonely', 'pnm.js');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(scratch.dir, 'lonely'));
    copyFileSync(BUNDLE, lonely);
    const result = await pnm(['validate', example('traffic-light')], { bundle: lonely, cwd: '/' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const layout = await pnm(['layout', example('traffic-light')], { bundle: lonely, cwd: '/' });
    expect(layout.status).toBe(0);
  });

  it('knows its version', async () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'apps', 'cli', 'package.json'), 'utf8')) as {
      version: string;
    };
    const result = await pnm(['--version']);
    expect(result).toMatchObject({ status: 0, stdout: `${pkg.version}\n`, stderr: '' });
  });
});

describe('help and usage errors', () => {
  it('prints the overview with --help and for no command', async () => {
    const help = await pnm(['--help']);
    expect(help.status).toBe(0);
    for (const command of [
      'validate',
      'simulate',
      'analyze',
      'check',
      'export',
      'import',
      'layout',
      'domain',
      'examples',
    ]) {
      expect(help.stdout).toContain(command);
    }
    const none = await pnm([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('Usage: pnm');
  });

  it.each([
    'validate',
    'simulate',
    'analyze',
    'check',
    'export',
    'import',
    'layout',
    'domain',
    'examples',
  ])('prints help for %s', async (command) => {
    const result = await pnm([command, '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`pnm ${command}`);
  });

  it('exits with 2 for unknown commands and options and missing arguments', async () => {
    for (const args of [
      ['frobnicate'],
      ['validate'],
      ['validate', example('traffic-light'), '--nope'],
      ['validate', 'a', 'b'],
      ['simulate', example('traffic-light'), '--seconds', 'abc'],
      ['simulate', example('traffic-light'), '--seconds', '-5'],
      ['export', example('traffic-light')],
      ['export', example('traffic-light'), '--format', 'pdf'],
      ['export', example('traffic-light'), '--format', 'svg', '--scale', '2'],
      ['layout', example('traffic-light'), '--direction', 'UP'],
      ['import'],
      ['domain'],
      ['domain', 'explode', example('traffic-light')],
      ['examples', 'nope'],
    ]) {
      const result = await pnm(args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).not.toBe('');
      expect(result.stdout).toBe('');
    }
  });

  it('exits with 1 for files that cannot be used', async () => {
    const missing = await pnm(['validate', tmp('missing.pn.json')]);
    expect(missing).toMatchObject({ status: 1, stdout: '' });
    expect(missing.stderr).toContain('no such file');
    writeFileSync(tmp('garbage.pn.json'), 'not json at all');
    const garbage = await pnm(['validate', tmp('garbage.pn.json')]);
    expect(garbage.status).toBe(1);
    expect(garbage.stderr).toContain('not valid JSON');
    const broken = await pnm(['validate', fixture('broken.pnml')]);
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('not well-formed');
  });
});

describe('pnm validate', () => {
  it('accepts every example, with and without domain view', async () => {
    for (const file of readdirSync(join(REPO, 'examples')).filter((f) => f.endsWith('.pn.json'))) {
      const result = await pnm(['validate', join(REPO, 'examples', file)]);
      expect(result.status, `${file}\n${result.stdout}${result.stderr}`).toBe(0);
    }
    const parcel = await pnm(['validate', example('parcel-center')]);
    expect(parcel.stdout).toContain('with domain view');
  });

  it('reports errors in a table and exits with 1', async () => {
    const net = load(example('producer-consumer'));
    net.arcs.push({ id: 'bad', source: net.places[0]!.id, target: 'nowhere', weight: 1 });
    writeFileSync(tmp('bad.pn.json'), serializeNet(net));
    const result = await pnm(['validate', tmp('bad.pn.json')]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('SEVERITY');
    expect(result.stdout).toContain('ARC_DANGLING');
    expect(result.stdout).toContain('1 error');
  });

  it('prints JSON', async () => {
    const net = load(example('producer-consumer'));
    net.arcs.push({ id: 'bad', source: net.places[0]!.id, target: 'nowhere', weight: 1 });
    writeFileSync(tmp('bad2.pn.json'), serializeNet(net));
    const bad = await pnm(['validate', tmp('bad2.pn.json'), '--json']);
    const data = JSON.parse(bad.stdout) as {
      ok: boolean;
      errors: number;
      diagnostics: Array<{ code: string }>;
      domainView: { present: boolean };
    };
    expect(bad.status).toBe(1);
    expect(data.ok).toBe(false);
    expect(data.diagnostics.map((d) => d.code)).toContain('ARC_DANGLING');
    expect(data.domainView.present).toBe(false);
    const good = JSON.parse(
      (await pnm(['validate', example('parcel-center'), '--json'])).stdout,
    ) as {
      ok: boolean;
      domainView: { present: boolean; ok: boolean };
    };
    expect(good).toMatchObject({ ok: true, domainView: { present: true, ok: true } });
  });

  it('checks the domain view and fails on its errors', async () => {
    const net = load(example('parcel-center'));
    const view = net.domainView as { places: Record<string, unknown> };
    view.places['ghost'] = view.places[Object.keys(view.places)[0]!];
    writeFileSync(tmp('badview.pn.json'), serializeNet(net));
    const result = await pnm(['validate', tmp('badview.pn.json')]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('V2');
  });

  it('reads PNML and reports what the import did', async () => {
    const result = await pnm(['validate', fixture('special-arcs.pnml')]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warning: The inhibitor arc');
    expect(result.stdout).toContain('3 places');
  });

  it('reads a net from standard input', async () => {
    const result = await pnm(['validate', '-'], {
      stdin: readFileSync(example('traffic-light'), 'utf8'),
    });
    expect(result.status).toBe(0);
  });
});

describe('pnm simulate', () => {
  it('writes the same CSV as the engine of the app for the same seed', async () => {
    const net = load(example('parcel-center'));
    const csv = tmp('parcel.csv');
    const result = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '7200',
      '--csv',
      csv,
    ]);
    expect(result.status).toBe(0);
    const expected = toEventLogCsv(
      await referenceEvents(net, net.simulation?.seed ?? 1, 7200),
      net,
    );
    const written = readFileSync(csv, 'utf8');
    expect(written.split('\n').length).toBeGreaterThan(1000);
    expect(written).toBe(expected);
    expect(result.stdout).toContain('cases completed');
    expect(result.stdout).toContain(`Wrote ${csv}`);
  });

  it('follows the seed option, and the XES file matches the engine too', async () => {
    const net = load(example('parcel-center'));
    const csv = tmp('seed7.csv');
    const xes = tmp('seed7.xes');
    const result = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '3600',
      '--seed',
      '7',
      '--csv',
      csv,
      '--xes',
      xes,
      '--quiet',
    ]);
    expect(result).toMatchObject({ status: 0, stdout: '' });
    const events = await referenceEvents(net, 7, 3600);
    expect(readFileSync(csv, 'utf8')).toBe(toEventLogCsv(events, net));
    expect(readFileSync(xes, 'utf8')).toBe(toXes(events, net));
    const other = tmp('seed8.csv');
    await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '3600',
      '--seed',
      '8',
      '--csv',
      other,
      '-q',
    ]);
    expect(readFileSync(other, 'utf8')).not.toBe(readFileSync(csv, 'utf8'));
  });

  it('is repeatable', async () => {
    const run = async (): Promise<string> =>
      (await pnm(['simulate', example('smart-office'), '--seconds', '1800'])).stdout;
    expect(await run()).toBe(await run());
  });

  it('writes metrics and the event stream', async () => {
    const metrics = tmp('metrics.json');
    const events = tmp('events.jsonl');
    const result = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '1200',
      '--metrics',
      metrics,
      '--events',
      events,
      '--quiet',
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(readFileSync(metrics, 'utf8')) as {
      seconds: number;
      seed: number;
      metrics: { completedCases: number; places: unknown[] };
    };
    expect(data).toMatchObject({ seconds: 1200, seed: 1 });
    expect(data.metrics.places.length).toBe(12);
    const lines = readFileSync(events, 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(100);
    const first = JSON.parse(lines[0] ?? '{}') as { id: number; type: string };
    expect(first.type).toBeTypeOf('string');
    expect(first.id).toBe(1);
  });

  it('changes arrivals with --rate and switches them off with off', async () => {
    const net = load(example('parcel-center'));
    const source = net.transitions.find((t) => t.rate !== undefined)!;
    const quiet = tmp('norate.json');
    const result = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '1800',
      '--rate',
      `${source.id}=off`,
      '--metrics',
      quiet,
      '-q',
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(readFileSync(quiet, 'utf8')) as { metrics: { completedCases: number } };
    expect(data.metrics.completedCases).toBe(0);
    const bad = await pnm(['simulate', example('parcel-center'), '--rate', 'nothing=3']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('source transitions');
    const notSource = await pnm([
      'simulate',
      example('parcel-center'),
      '--rate',
      `${net.transitions[2]!.id}=3`,
    ]);
    expect(notSource.status).toBe(2);
  });

  it('sends files to standard output with - and moves the summary to standard error', async () => {
    const result = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '600',
      '--csv',
      '-',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('case_id,activity,timestamp,lifecycle\n')).toBe(true);
    expect(result.stderr).toContain('cases completed');
  });

  it('refuses nets with errors', async () => {
    const net = load(example('producer-consumer'));
    net.arcs.push({ id: 'bad', source: net.places[0]!.id, target: 'nowhere', weight: 1 });
    writeFileSync(tmp('bad3.pn.json'), serializeNet(net));
    const result = await pnm(['simulate', tmp('bad3.pn.json')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has errors');
  });

  it('simulates a PNML file and a JSON net', async () => {
    const pnml = await pnm(['simulate', fixture('two-pages.pnml'), '--seconds', '60']);
    expect(pnml.status).toBe(0);
    const json = await pnm(['simulate', example('order-processing'), '--seconds', '60']);
    expect(json.status).toBe(0);
  });
});

describe('pnm export', () => {
  const sources = ['producer-consumer', 'order-processing'];

  it.each(sources)('writes SVG like the library for %s', async (name) => {
    const net = load(example(name));
    const result = await pnm(['export', example(name), '--format', 'svg']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(netToSvg(net));
    const dark = await pnm([
      'export',
      example(name),
      '--format',
      'svg',
      '--dark',
      '--no-inscriptions',
      '--padding',
      '10',
    ]);
    expect(dark.stdout).toBe(netToSvg(net, { dark: true, inscriptions: false, padding: 10 }));
  });

  it.each(sources)('writes TikZ like the library for %s', async (name) => {
    const net = load(example(name));
    expect((await pnm(['export', example(name), '-f', 'tikz'])).stdout).toBe(toTikz(net));
    const options = await pnm([
      'export',
      example(name),
      '-f',
      'tikz',
      '--standalone',
      '--scale',
      '0.01',
      '--labels',
      'ids',
      '--tokens',
      'count',
      '--styles',
      'external',
      '--no-grayscale',
      '--no-inscriptions',
    ]);
    expect(options.stdout).toBe(
      toTikz(net, {
        standalone: true,
        scale: 0.01,
        labels: 'ids',
        tokens: 'count',
        styles: 'external',
        grayscale: false,
        inscriptions: false,
      }),
    );
  });

  it.each(sources)('writes PNML and JSON for %s', async (name) => {
    const net = load(example(name));
    expect((await pnm(['export', example(name), '-f', 'pnml'])).stdout).toBe(toPnml(net));
    expect((await pnm(['export', example(name), '-f', 'pnml', '--no-toolspecific'])).stdout).toBe(
      toPnml(net, { toolspecific: false }),
    );
    expect((await pnm(['export', example(name), '-f', 'json'])).stdout).toBe(serializeNet(net));
  });

  it('writes to a file and takes the format from its extension', async () => {
    for (const [file, marker] of [
      ['out.svg', '<svg'],
      ['out.pnml', '<pnml'],
      ['out.tex', '\\begin{tikzpicture}'],
      ['out.json', '"places"'],
    ] as const) {
      const target = tmp(join('exports', file));
      const result = await pnm(['export', example('traffic-light'), '-o', target]);
      expect(result.status, file).toBe(0);
      expect(result.stdout).toBe('');
      expect(readFileSync(target, 'utf8')).toContain(marker);
    }
  });

  it('says clearly that PNG is not available', async () => {
    const result = await pnm([
      'export',
      example('traffic-light'),
      '--format',
      'png',
      '-o',
      tmp('x.png'),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PNG export needs a browser');
    expect(result.stderr).toContain('web app');
    expect(existsSync(tmp('x.png'))).toBe(false);
  });

  it('converts PNML to JSON and back to PNML without loss', async () => {
    const pnml = (await pnm(['export', example('order-processing'), '-f', 'pnml'])).stdout;
    const json = await pnm(['import', '-'], { stdin: pnml });
    expect(json.status).toBe(0);
    expect(json.stdout).toBe(serializeNet(load(example('order-processing'))));
  });
});

describe('pnm import', () => {
  it('reads the PNML of the mockup, lays it out and writes a valid net', async () => {
    const target = tmp('rekla.pn.json');
    const result = await pnm(['import', fixture('mockup-reklamation.pnml'), '-o', target]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('8 places, 7 transitions, 16 arcs');
    expect(result.stderr).toContain('laid out automatically');
    const net = load(target);
    expect(net.name).toBe('Reklamation');
    expect(validate(net).filter((d) => d.severity === 'error')).toEqual([]);
    const spots = new Set(
      [...net.places, ...net.transitions].map((n) => `${n.position.x}:${n.position.y}`),
    );
    expect(spots.size).toBe(15);
  });

  it('keeps or recomputes positions', async () => {
    const keep = await pnm(['import', fixture('prom-like.pnml')]);
    expect(JSON.parse(keep.stdout).places[0].position).toEqual({ x: 40.5, y: 120 });
    const auto = await pnm(['import', fixture('prom-like.pnml'), '--layout', 'auto']);
    expect(JSON.parse(auto.stdout).places[0].position).not.toEqual({ x: 40.5, y: 120 });
    expect((await pnm(['import', fixture('prom-like.pnml'), '--layout', 'x'])).status).toBe(2);
  });

  it('prints the warnings of the import', async () => {
    const result = await pnm(['import', fixture('pm4py.pnml')]);
    expect(result.stderr).toContain('warning: Final markings are not supported');
    expect(result.stderr).toContain('warning: The file has no (or incomplete) positions');
  });

  it('fails for XML that is not PNML', async () => {
    for (const file of ['not-pnml.xml', 'no-net.pnml', 'broken.pnml']) {
      const result = await pnm(['import', fixture(file)]);
      expect(result.status, file).toBe(1);
      expect(result.stdout).toBe('');
    }
  });
});

describe('pnm layout', () => {
  async function laidOut(args: string[], target: string): Promise<PetriNet> {
    const result = await pnm(args);
    expect(result.status, result.stderr).toBe(0);
    return load(target);
  }

  it('moves the nodes and drops bend points', async () => {
    const net = load(example('producer-consumer'));
    net.arcs[0]!.points = [{ x: 1, y: 1 }];
    writeFileSync(tmp('bent.pn.json'), serializeNet(net));
    const right = await laidOut(
      ['layout', tmp('bent.pn.json'), '-o', tmp('right.pn.json')],
      tmp('right.pn.json'),
    );
    expect(right.arcs[0]!.points).toBeUndefined();
    const down = await laidOut(
      ['layout', tmp('bent.pn.json'), '--direction', 'DOWN', '-o', tmp('down.pn.json')],
      tmp('down.pn.json'),
    );
    const span = (n: PetriNet, axis: 'x' | 'y'): number => {
      const values = [...n.places, ...n.transitions].map((p) => p.position[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    expect(span(right, 'x')).toBeGreaterThan(span(right, 'y'));
    expect(span(down, 'y')).toBeGreaterThan(span(down, 'x'));
    for (const node of [...right.places, ...right.transitions]) {
      expect(node.position.x % 10).toBe(0);
      expect(node.position.y % 10).toBe(0);
    }
    expect(right.places.map((p) => p.id)).toEqual(net.places.map((p) => p.id));
  });

  it('writes PNML when the output name asks for it', async () => {
    const target = tmp('laid.pnml');
    expect((await pnm(['layout', example('traffic-light'), '-o', target])).status).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('<pnml');
  });
});

describe('pnm domain', () => {
  it('checks the view of an example', async () => {
    const result = await pnm(['domain', 'check', example('parcel-center')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('domain view ok');
    const json = JSON.parse(
      (await pnm(['domain', 'check', example('smart-office'), '--json'])).stdout,
    ) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('fails without a view and for a view with errors', async () => {
    const none = await pnm(['domain', 'check', example('traffic-light')]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no domain view');
    writeFileSync(tmp('badview.json'), JSON.stringify({ schemaVersion: 1 }));
    const bad = await pnm([
      'domain',
      'check',
      example('traffic-light'),
      '--view',
      tmp('badview.json'),
    ]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('V1');
    const unreadable = await pnm([
      'domain',
      'check',
      example('traffic-light'),
      '--view',
      tmp('absent.json'),
    ]);
    expect(unreadable.status).toBe(1);
  });

  it('adds a generic view that passes the check', async () => {
    const target = tmp('generic.pn.json');
    const made = await pnm(['domain', 'generic', example('traffic-light'), '-o', target]);
    expect(made.status).toBe(0);
    expect(load(target).domainView).toBeDefined();
    const check = await pnm(['domain', 'check', target]);
    expect(check.status).toBe(0);
    const only = await pnm(['domain', 'generic', example('traffic-light'), '--view-only']);
    expect(JSON.parse(only.stdout)).toMatchObject({ schemaVersion: 1 });
  });

  it('adds a generic view to a PNML file without positions', async () => {
    const made = await pnm(['domain', 'generic', fixture('mockup-reklamation.pnml')]);
    expect(made.status).toBe(0);
    const net = parseNetText(made.stdout);
    expect(net.domainView).toBeDefined();
    expect(Object.keys(net.domainView as object)).toContain('places');
  });

  describe('generate', () => {
    interface Seen {
      headers: IncomingHttpHeaders;
      bodies: string[];
    }

    async function withServer<T>(
      content: string,
      body: (url: string, seen: Seen) => Promise<T>,
    ): Promise<T> {
      const seen: Seen = { headers: {}, bodies: [] };
      const server = createServer((request, response) => {
        let text = '';
        request.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8');
        });
        request.on('end', () => {
          seen.headers = request.headers;
          seen.bodies.push(text);
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              model: 'fake-model',
              choices: [
                { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
              ],
            }),
          );
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        return await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it('asks the model, falls back to the generic view and never prints the key', async () => {
      await withServer('{}', async (url, seen) => {
        const target = tmp('generated.pn.json');
        const result = await pnm(
          [
            'domain',
            'generate',
            example('traffic-light'),
            '--description',
            'A crossing in town.',
            '--base-url',
            url,
            '--model',
            'fake-model',
            '--rounds',
            '2',
            '-o',
            target,
          ],
          { env: { PNM_LLM_API_KEY: 'sk-secret-key-123456' } },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(seen.headers['authorization']).toBe('Bearer sk-secret-key-123456');
        expect(seen.bodies).toHaveLength(2);
        expect(result.stdout + result.stderr).not.toContain('sk-secret-key-123456');
        const text = readFileSync(target, 'utf8');
        expect(text).not.toContain('sk-secret-key-123456');
        const net = parseNetText(text);
        expect(net.domainView).toBeDefined();
        expect(net.domainViewGeneration).toMatchObject({ model: 'fake-model' });
        expect(result.stderr).toContain('round 1');
        expect(result.stderr).toContain('generic view was used');
        expect((await pnm(['domain', 'check', target])).status).toBe(0);
      });
    });

    it('takes the key from --api-key and is quiet on request', async () => {
      await withServer('{}', async (url, seen) => {
        const result = await pnm([
          'domain',
          'generate',
          example('traffic-light'),
          '--description',
          'x',
          '--base-url',
          url,
          '--model',
          'm',
          '--rounds',
          '1',
          '--api-key',
          'k-12345678',
          '-q',
        ]);
        expect(result.status).toBe(0);
        expect(seen.headers['authorization']).toBe('Bearer k-12345678');
        expect(result.stderr).not.toContain('round 1');
        expect(result.stdout).toContain('"domainView"');
      });
    });

    it('needs a description, a server and a model', async () => {
      expect(
        (
          await pnm([
            'domain',
            'generate',
            example('traffic-light'),
            '--base-url',
            'http://x/v1',
            '--model',
            'm',
          ])
        ).status,
      ).toBe(2);
      expect(
        (
          await pnm([
            'domain',
            'generate',
            example('traffic-light'),
            '--description',
            'd',
            '--model',
            'm',
          ])
        ).status,
      ).toBe(2);
      expect(
        (
          await pnm([
            'domain',
            'generate',
            example('traffic-light'),
            '--description',
            'd',
            '--base-url',
            'http://x/v1',
          ])
        ).status,
      ).toBe(2);
    });

    it('fails with 1 when the server cannot be reached', async () => {
      const result = await pnm([
        'domain',
        'generate',
        example('traffic-light'),
        '--description',
        'd',
        '--base-url',
        'http://127.0.0.1:9/v1',
        '--model',
        'm',
        '--timeout',
        '5',
        '-q',
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('language model');
    });
  });
});

describe('pnm examples', () => {
  it('lists the examples of the repository', async () => {
    const result = await pnm(['examples', 'list']);
    expect(result.status).toBe(0);
    const names = readdirSync(join(REPO, 'examples'))
      .filter((f) => f.endsWith('.pn.json'))
      .map((f) => f.replace('.pn.json', ''));
    for (const name of names) expect(result.stdout).toContain(name);
  });

  it('copies an example, but not over an existing file', async () => {
    const dir = tmp('copied');
    const first = await pnm(['examples', 'copy', 'token-ring', dir]);
    expect(first.status).toBe(0);
    expect(readFileSync(join(dir, 'token-ring.pn.json'), 'utf8')).toBe(
      readFileSync(example('token-ring'), 'utf8'),
    );
    const again = await pnm(['examples', 'copy', 'token-ring', dir]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('--force');
    expect((await pnm(['examples', 'copy', 'token-ring', dir, '--force'])).status).toBe(0);
    expect((await pnm(['examples', 'copy', 'nothing', dir])).status).toBe(1);
    expect((await pnm(['examples', 'copy', 'token-ring', '-'])).stdout).toBe(
      readFileSync(example('token-ring'), 'utf8'),
    );
  });
});
