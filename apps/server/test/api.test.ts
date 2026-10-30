import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { example, json, pnm, postJson, startApp, type RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(env: Record<string, string | undefined> = {}): Promise<RunningApp> {
  running = await startApp(env);
  return running;
}

const EXAMPLES = [
  'bike-frames',
  'complaint-handling',
  'dining-philosophers-3',
  'dining-philosophers-json',
  'mutual-exclusion',
  'order-processing',
  'parcel-center',
  'producer-consumer',
  'smart-office',
  'token-ring',
  'traffic-light',
];

function netOf(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(example(name), 'utf8')) as Record<string, unknown>;
}

/** What the command line prints with `--json`, without the name of the file. */
function withoutFile(text: string): Record<string, unknown> {
  const { file: _file, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
}

/** The domain view stores the time of its creation in each entry; it is the only difference. */
function withoutTimes(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v: unknown) => (key === 'at' ? undefined : v));
}

/** A P/T net with a dangling arc: it has an error. */
function brokenNet(): Record<string, unknown> {
  const net = netOf('traffic-light');
  (net['arcs'] as Array<Record<string, unknown>>).push({
    id: 'broken',
    source: 'nowhere',
    target: (net['transitions'] as Array<Record<string, unknown>>)[0]?.['id'],
    weight: 1,
  });
  return net;
}

/** A JSON net whose guard is a regular expression that takes (practically) for ever. */
function slowNet(): Record<string, unknown> {
  return {
    version: '1.0',
    profile: 'json-net',
    name: 'Slow guard',
    types: { Item: { type: 'object' } },
    places: [
      { id: 'p', name: 'p', type: 'Item', position: { x: 0, y: 0 } },
      { id: 'q', name: 'q', type: 'Item', position: { x: 200, y: 0 } },
    ],
    transitions: [
      {
        id: 't',
        name: 't',
        guard: '$count($match("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", /^(a+)+$/)) = 0',
        position: { x: 100, y: 0 },
      },
    ],
    arcs: [
      { id: 'a1', source: 'p', target: 't', weight: 1, inscription: '$x' },
      { id: 'a2', source: 't', target: 'q', weight: 1, inscription: '$x' },
    ],
    marking: { p: [{ a: 1 }] },
  };
}

/** A net with a source transition: its state space never ends. */
function endlessNet(): Record<string, unknown> {
  return {
    version: '1.0',
    profile: 'pt-net',
    name: 'Endless',
    types: {},
    places: [{ id: 'p', name: 'p', position: { x: 200, y: 0 } }],
    transitions: [{ id: 't', name: 't', position: { x: 0, y: 0 } }],
    arcs: [{ id: 'a', source: 't', target: 'p', weight: 1 }],
    marking: {},
  };
}

describe('the interface gives what the command line gives', () => {
  it('validate: the same findings for every example', async () => {
    const { url } = await start();
    for (const name of EXAMPLES) {
      const response = await postJson(url, '/api/v1/validate', { net: netOf(name) });
      expect(response.status, name).toBe(200);
      const cli = await pnm(['validate', example(name), '--json']);
      expect(await response.json(), name).toEqual(withoutFile(cli.stdout));
    }
  });

  it('validate: accepts the net as it is, without the envelope', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/validate', netOf('traffic-light'));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ok: true, places: expect.any(Number) });
  });

  it('validate: reports the errors of a broken net with 200 and ok false', async () => {
    const { url } = await start();
    const body = await json(await postJson(url, '/api/v1/validate', { net: brokenNet() }));
    expect(body['ok']).toBe(false);
    expect(body['diagnostics']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ARC_DANGLING', severity: 'error' }),
      ]),
    );
  });

  it('simulate: the same key figures, log and seed handling', async () => {
    const { url } = await start();
    for (const name of ['traffic-light', 'parcel-center', 'order-processing', 'smart-office']) {
      const response = await postJson(url, '/api/v1/simulate', {
        net: netOf(name),
        seconds: 900,
        seed: 3,
      });
      expect(response.status, name).toBe(200);
      const cli = await pnm([
        'simulate',
        example(name),
        '--seconds',
        '900',
        '--seed',
        '3',
        '--metrics',
        '-',
        '-q',
      ]);
      expect(await response.json(), name).toEqual(JSON.parse(cli.stdout));
    }
  });

  it('simulate: the indicators of the net are in the key figures, the same as on the command line', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/simulate', {
      net: netOf('bike-frames'),
      seconds: 8 * 3600,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      metrics: { indicators: Array<{ id: string; label: string; unit: string; value: number }> };
    };
    const cli = await pnm([
      'simulate',
      example('bike-frames'),
      '--seconds',
      '28800',
      '--metrics',
      '-',
      '-q',
    ]);
    expect(body).toEqual(JSON.parse(cli.stdout));
    expect(body.metrics.indicators.map((i) => [i.id, i.unit])).toEqual([
      ['co2-per-frame', 'kg'],
      ['material', 'kg'],
      ['recycled-share', '%'],
      ['waste', 'kg'],
    ]);
    expect(body.metrics.indicators[0]!.value).toBeGreaterThan(10);
    expect(body.metrics.indicators[0]!.value).toBeLessThan(20);
    // A net without indicators has none in the answer.
    const plain = await postJson(url, '/api/v1/simulate', {
      net: netOf('traffic-light'),
      seconds: 60,
    });
    expect((await json(plain))['metrics']).not.toHaveProperty('indicators');
  });

  it('validate: reports an indicator that points to nothing, with its path', async () => {
    const { url } = await start();
    const net = netOf('bike-frames') as { simulation: { indicators: Array<{ measure: unknown }> } };
    net.simulation.indicators[0]!.measure = { kind: 'inflow', of: 'p_nowhere' };
    const body = await json(await postJson(url, '/api/v1/validate', { net }));
    expect(body['ok']).toBe(false);
    expect(body['diagnostics']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INDICATOR_INVALID',
          path: 'simulation.indicators[0].measure.of',
        }),
      ]),
    );
  });

  it('simulate: returns the event log as CSV, XES and as a stream, equal to the files of the CLI', async () => {
    const { url } = await start();
    const net = netOf('order-processing');
    const body = await json(
      await postJson(url, '/api/v1/simulate', {
        net,
        seconds: 600,
        seed: 5,
        startTime: '2026-01-02T03:04:05Z',
        formats: ['csv', 'xes', 'stream'],
      }),
    );
    const args = [
      'simulate',
      example('order-processing'),
      '--seconds',
      '600',
      '--seed',
      '5',
      '--start-time',
      '2026-01-02T03:04:05Z',
      '-q',
    ];
    expect(body['csv']).toBe((await pnm([...args, '--csv', '-'])).stdout);
    expect(body['xes']).toBe((await pnm([...args, '--xes', '-'])).stdout);
    const lines = (await pnm([...args, '--events', '-'])).stdout.trim().split('\n');
    expect(body['stream']).toEqual(lines.map((line) => JSON.parse(line) as unknown));
    expect(body['events']).toBe(lines.length);
  });

  it('simulate: honours rates and a seed from the net', async () => {
    const { url } = await start();
    const net = netOf('parcel-center');
    // The delivery is the source transition of the parcel center.
    const key = 'Anlieferung';
    const withRate = await json(
      await postJson(url, '/api/v1/simulate', { net, seconds: 1200, rates: { [key]: 5 } }),
    );
    const off = await json(
      await postJson(url, '/api/v1/simulate', { net, seconds: 1200, rates: { [key]: 'off' } }),
    );
    const cli = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '1200',
      '--rate',
      `${key}=5`,
      '--metrics',
      '-',
      '-q',
    ]);
    expect(withRate).toEqual(JSON.parse(cli.stdout));
    expect(off['events']).toBeLessThan(withRate['events']);
  });

  it('analyze: the same result as pnm analyze --json', async () => {
    const { url } = await start();
    for (const name of [
      'traffic-light',
      'producer-consumer',
      'dining-philosophers-3',
      'order-processing',
      'mutual-exclusion',
    ]) {
      const response = await postJson(url, '/api/v1/analyze', {
        net: netOf(name),
        states: 2000,
        timeMs: 5000,
      });
      expect(response.status, name).toBe(200);
      const cli = await pnm([
        'analyze',
        example(name),
        '--states',
        '2000',
        '--time',
        '5000',
        '--json',
      ]);
      expect(await response.json(), name).toEqual(withoutFile(cli.stdout));
    }
  });

  it('analyze: structureOnly and coverability work', async () => {
    const { url } = await start();
    const net = netOf('producer-consumer');
    const only = await json(await postJson(url, '/api/v1/analyze', { net, structureOnly: true }));
    expect(only['stateSpace']).toBeNull();
    const cli = await pnm(['analyze', example('producer-consumer'), '--structure-only', '--json']);
    expect(only).toEqual(withoutFile(cli.stdout));
    const cov = await json(await postJson(url, '/api/v1/analyze', { net, coverability: true }));
    expect(cov['coverability']).not.toBeNull();
  });

  it('check: the same verdicts and counterexamples on the state space', async () => {
    const { url } = await start();
    const declare = ['response(Approve, Create invoice)', 'existence(Approve)'];
    const response = await postJson(url, '/api/v1/check', {
      net: netOf('order-processing'),
      declare,
    });
    expect(response.status).toBe(200);
    const cli = await pnm([
      'check',
      example('order-processing'),
      '--declare',
      declare[0]!,
      '--declare',
      declare[1]!,
      '--json',
    ]);
    expect(await response.json()).toEqual(withoutFile(cli.stdout));
  });

  it('check: LTLf, final markings and stored properties', async () => {
    const { url } = await start();
    const net = netOf('producer-consumer');
    const ltlf = await postJson(url, '/api/v1/check', { net, ltlf: ['F produce'], final: 'all' });
    const cliLtlf = await pnm([
      'check',
      example('producer-consumer'),
      '--ltlf',
      'F produce',
      '--final',
      'all',
      '--json',
    ]);
    expect(await ltlf.json()).toEqual(withoutFile(cliLtlf.stdout));
    const stored = await postJson(url, '/api/v1/check', { net: netOf('order-processing') });
    const cliStored = await pnm(['check', example('order-processing'), '--json']);
    expect(await stored.json()).toEqual(withoutFile(cliStored.stdout));
  });

  it('check: against an event log, equal to pnm check --log', async () => {
    const { url } = await start();
    const csv = (
      await pnm(['simulate', example('order-processing'), '--seconds', '3600', '--csv', '-', '-q'])
    ).stdout;
    const declare = 'response(Approve, Create invoice)';
    const response = await postJson(url, '/api/v1/check', {
      net: netOf('order-processing'),
      declare: [declare],
      log: csv,
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body['mode']).toBe('log');
    // The CLI wants a file for the log.
    const { tempDir } = await import('./helpers');
    const scratch = tempDir();
    try {
      const { writeFileSync } = await import('node:fs');
      const file = `${scratch.dir}/log.csv`;
      writeFileSync(file, csv);
      const cli = await pnm([
        'check',
        example('order-processing'),
        '--declare',
        declare,
        '--log',
        file,
        '--json',
      ]);
      const { log: _log, ...expected } = withoutFile(cli.stdout);
      expect(body).toEqual(expected);
    } finally {
      scratch.cleanup();
    }
  });

  it('replay: fitness, deviations and key figures equal to pnm replay --json', async () => {
    const { url } = await start();
    const csv = (
      await pnm(['simulate', example('parcel-center'), '--seconds', '3600', '--csv', '-', '-q'])
    ).stdout;
    const response = await postJson(url, '/api/v1/replay', {
      net: netOf('parcel-center'),
      log: csv,
      timeOrigin: 'net',
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body['fitness']).toBe(1);
    const { tempDir } = await import('./helpers');
    const scratch = tempDir();
    try {
      const { writeFileSync } = await import('node:fs');
      const file = `${scratch.dir}/log.csv`;
      writeFileSync(file, csv);
      const cli = await pnm([
        'replay',
        example('parcel-center'),
        file,
        '--time-origin',
        'net',
        '--json',
        '-q',
      ]);
      const { log: _log, ...expected } = withoutFile(cli.stdout);
      const { logWarnings, ...rest } = body;
      expect(logWarnings).toEqual([]);
      expect(rest).toEqual(expected);
    } finally {
      scratch.cleanup();
    }
  });

  it('replay: deviations on a log that does not fit, and the replayed log as CSV', async () => {
    const { url } = await start();
    const csv = (
      await pnm(['simulate', example('parcel-center'), '--seconds', '3600', '--csv', '-', '-q'])
    ).stdout;
    const body = await json(
      await postJson(url, '/api/v1/replay', {
        net: netOf('producer-consumer'),
        log: csv,
        formats: ['csv'],
      }),
    );
    expect(body['skippedActivities'].length).toBeGreaterThan(0);
    expect(typeof body['csv']).toBe('string');
  });

  it('convert: the file is what pnm export writes', async () => {
    const { url } = await start();
    const net = netOf('order-processing');
    const cases: Array<[string, string, string]> = [
      ['svg', 'image/svg+xml', 'svg'],
      ['tikz', 'application/x-tex', 'tex'],
      ['pnml', 'application/xml', 'pnml'],
      ['json', 'application/json', 'pn.json'],
    ];
    for (const [format, type, extension] of cases) {
      const response = await postJson(url, '/api/v1/convert', { net, format });
      expect(response.status, format).toBe(200);
      expect(response.headers.get('content-type'), format).toContain(type);
      expect(response.headers.get('content-disposition'), format).toBe(
        `attachment; filename="Order-processing.${extension}"`.replace(
          'Order-processing',
          fileStemOf(net),
        ),
      );
      const cli = await pnm(['export', example('order-processing'), '--format', format]);
      expect(await response.text(), format).toBe(cli.stdout);
    }
  });

  it('convert: options and ?format= with a net sent as it is', async () => {
    const { url } = await start();
    const net = netOf('traffic-light');
    const tikz = await postJson(url, '/api/v1/convert?format=tikz', net);
    expect(tikz.status).toBe(200);
    expect(await tikz.text()).toBe(
      (await pnm(['export', example('traffic-light'), '--format', 'tikz'])).stdout,
    );
    const dark = await postJson(url, '/api/v1/convert', {
      net,
      format: 'svg',
      dark: true,
      padding: 10,
      inscriptions: false,
    });
    const cli = await pnm([
      'export',
      example('traffic-light'),
      '--format',
      'svg',
      '--dark',
      '--padding',
      '10',
      '--no-inscriptions',
    ]);
    expect(await dark.text()).toBe(cli.stdout);
  });

  it('convert: reads PNML', async () => {
    const { url } = await start();
    const pnml = (await pnm(['export', example('traffic-light'), '--format', 'pnml'])).stdout;
    const response = await postJson(url, '/api/v1/convert', { net: pnml, format: 'json' });
    expect(response.status).toBe(200);
    const cli = await pnm(['import', '-'], { stdin: pnml });
    expect(await response.text()).toBe(cli.stdout);
  });

  it('layout: the net with the positions the CLI computes', async () => {
    const { url } = await start();
    for (const name of ['traffic-light', 'order-processing']) {
      const response = await postJson(url, '/api/v1/layout', {
        net: netOf(name),
        direction: 'DOWN',
        spacing: 80,
      });
      expect(response.status, name).toBe(200);
      const cli = await pnm(['layout', example(name), '--direction', 'DOWN', '--spacing', '80']);
      expect((await json(response))['net'], name).toEqual(JSON.parse(cli.stdout));
    }
  });

  it('domain/check and domain/generic: the same as pnm domain', async () => {
    const { url } = await start();
    const check = await postJson(url, '/api/v1/domain/check', { net: netOf('parcel-center') });
    const cliCheck = await pnm(['domain', 'check', example('parcel-center'), '--json']);
    expect(await check.json()).toEqual(withoutFile(cliCheck.stdout));
    const generic = await json(
      await postJson(url, '/api/v1/domain/generic', { net: netOf('traffic-light') }),
    );
    const cliGeneric = await pnm(['domain', 'generic', example('traffic-light'), '-o', '-']);
    expect(withoutTimes(generic['net'])).toEqual(withoutTimes(JSON.parse(cliGeneric.stdout)));
    // The view that was made passes its own check.
    const again = await json(await postJson(url, '/api/v1/domain/check', { net: generic['net'] }));
    expect(again['ok']).toBe(true);
  });

  it('domain/check says so when there is no view', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/domain/check', { net: netOf('traffic-light') });
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ error: { code: 'unprocessable' } });
  });
});

function fileStemOf(net: Record<string, unknown>): string {
  return String(net['name'])
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

describe('errors', () => {
  it('400 for a body that is not JSON, has no net, or has options that are wrong', async () => {
    const { url } = await start();
    const cases: Array<[string, unknown, string]> = [
      ['not json', '{oops', 'invalid_json'],
      ['empty object', {}, 'bad_request'],
      ['array', [], 'bad_request'],
      ['unknown option', { net: netOf('traffic-light'), secnds: 5 }, 'bad_request'],
      ['wrong type', { net: netOf('traffic-light'), seconds: 'long' }, 'bad_request'],
      ['negative', { net: netOf('traffic-light'), seconds: -1 }, 'bad_request'],
      ['too many states', { net: netOf('traffic-light'), states: 1e12 }, 'bad_request'],
      ['bad format', { net: netOf('traffic-light'), format: 'doc' }, 'bad_request'],
    ];
    for (const [label, body, code] of cases) {
      const path = label === 'bad format' ? '/api/v1/convert' : '/api/v1/simulate';
      const response = await postJson(url, path, body);
      expect(response.status, label).toBe(400);
      const parsed = await json(response);
      expect(parsed['error']['code'], label).toBe(code);
      expect(parsed['error']['message'], label).toEqual(expect.any(String));
    }
  });

  it('names the option that is wrong', async () => {
    const { url } = await start();
    const body = await json(
      await postJson(url, '/api/v1/simulate', { net: netOf('traffic-light'), seconds: 'long' }),
    );
    expect(body['error']['message']).toContain('seconds');
    expect(body['error']['details']['issues'][0]['path']).toBe('seconds');
  });

  it('400 for a rate that names no source transition, a map that names no activity', async () => {
    const { url } = await start();
    const rate = await postJson(url, '/api/v1/simulate', {
      net: netOf('parcel-center'),
      rates: { Nonexistent: 3 },
    });
    expect(rate.status).toBe(400);
    expect((await json(rate))['error']['message']).toContain('rates');
    const csv = (
      await pnm(['simulate', example('parcel-center'), '--seconds', '600', '--csv', '-', '-q'])
    ).stdout;
    const map = await postJson(url, '/api/v1/replay', {
      net: netOf('parcel-center'),
      log: csv,
      map: { Nope: 'x' },
    });
    expect(map.status).toBe(400);
  });

  it('400 for a property that cannot be read', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/check', {
      net: netOf('order-processing'),
      declare: ['frobnicate(x)'],
    });
    expect(response.status).toBe(400);
  });

  it('415 without the JSON content type', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/v1/validate`, {
      method: 'POST',
      body: JSON.stringify({ net: netOf('traffic-light') }),
    });
    expect(response.status).toBe(415);
    const form = await fetch(`${url}/api/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ net: netOf('traffic-light') }),
    });
    expect(form.status).toBe(415);
  });

  it('413 for a request over the limit', async () => {
    const { url } = await start({ PNM_MAX_BODY: '64kb' });
    const response = await postJson(url, '/api/v1/validate', {
      net: netOf('smart-office'),
      padding: 'x'.repeat(100_000),
    });
    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({ error: { code: 'payload_too_large' } });
    // A request under the limit is fine.
    expect((await postJson(url, '/api/v1/validate', { net: netOf('traffic-light') })).status).toBe(
      200,
    );
  });

  it('422 for a document that is no net, and for PNML that is none', async () => {
    const { url } = await start();
    const broken = await postJson(url, '/api/v1/validate', {
      net: { version: '1.0', places: 'no' },
    });
    expect(broken.status).toBe(422);
    expect(await json(broken)).toMatchObject({ error: { code: 'net_format' } });
    const pnml = await postJson(url, '/api/v1/validate', { net: '<pnml><net>' });
    expect(pnml.status).toBe(422);
    const text = await postJson(url, '/api/v1/validate', { net: 'just some text' });
    expect(text.status).toBe(422);
  });

  it('422 with the findings for a net with errors that cannot be run', async () => {
    const { url } = await start();
    const paths = ['/api/v1/simulate', '/api/v1/analyze', '/api/v1/check'];
    for (const path of paths) {
      const response = await postJson(url, path, {
        net: brokenNet(),
        ...(path.endsWith('check') && { declare: ['existence(Red)'] }),
      });
      expect(response.status, path).toBe(422);
      const body = await json(response);
      expect(body['error']['code'], path).toBe('net_invalid');
      expect(body['error']['details']['diagnostics'][0]).toMatchObject({ code: 'ARC_DANGLING' });
    }
  });

  it('422 when the run produces too many events, with advice in the words of the interface', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/simulate', {
      net: netOf('parcel-center'),
      seconds: 100_000,
      maxEvents: 500,
    });
    expect(response.status).toBe(422);
    const message = (await json(response))['error']['message'] as string;
    expect(message).toContain('more than 500 events');
    expect(message).toContain('"maxEvents"');
    expect(message).not.toContain('--');
    const withLog = await postJson(url, '/api/v1/simulate', {
      net: netOf('parcel-center'),
      seconds: 1_000_000,
      formats: ['csv'],
    });
    expect(withLog.status).toBe(422);
    expect((await json(withLog))['error']['message'] as string).toContain('formats');
  });

  it('504 for an analysis that takes too long, and the server goes on', async () => {
    const { url, app } = await start({ PNM_JOB_TIMEOUT: '1.5', PNM_WORKERS: '1' });
    const started = Date.now();
    const response = await postJson(url, '/api/v1/analyze', { net: slowNet() });
    expect(response.status).toBe(504);
    expect(await json(response)).toMatchObject({ error: { code: 'timeout' } });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(app.pool.stats().running).toBe(0);
    // The thread that was stuck is gone; the next job runs on a new one.
    const next = await postJson(url, '/api/v1/analyze', { net: netOf('traffic-light') });
    expect(next.status).toBe(200);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  it('504 for a simulation with the slow guard as well', async () => {
    const { url } = await start({ PNM_JOB_TIMEOUT: '1.5' });
    const net = slowNet();
    (net['transitions'] as Array<Record<string, unknown>>)[0]!['rate'] = undefined;
    const response = await postJson(url, '/api/v1/check', { net, declare: ['existence(t)'] });
    expect(response.status).toBe(504);
  });

  it('503 when every thread is busy and the queue is full', async () => {
    const { url } = await start({ PNM_JOB_TIMEOUT: '2', PNM_WORKERS: '1', PNM_JOB_QUEUE: '0' });
    const slow = postJson(url, '/api/v1/analyze', { net: slowNet() });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const refused = await postJson(url, '/api/v1/validate', { net: netOf('traffic-light') });
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await json(refused)).toMatchObject({ error: { code: 'busy' } });
    expect((await slow).status).toBe(504);
  });

  it('422 when a job needs more memory than the limit', async () => {
    const { url } = await start({
      PNM_WORKER_MEMORY: '64',
      PNM_JOB_TIMEOUT: '40',
      PNM_WORKERS: '1',
    });
    const response = await postJson(url, '/api/v1/analyze', {
      net: endlessNet(),
      states: 2_000_000,
      timeMs: 40_000,
    });
    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({ error: { code: 'resource_limit' } });
    expect((await postJson(url, '/api/v1/validate', { net: netOf('traffic-light') })).status).toBe(
      200,
    );
  }, 60_000);

  it('stops a job when the client goes away', async () => {
    const { url, app } = await start({ PNM_JOB_TIMEOUT: '30', PNM_WORKERS: '1' });
    const controller = new AbortController();
    const request = fetch(`${url}/api/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ net: slowNet() }),
      signal: controller.signal,
    }).catch(() => undefined);
    const until = Date.now() + 5000;
    while (app.pool.stats().running === 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(app.pool.stats().running).toBe(1);
    controller.abort();
    await request;
    const stopped = Date.now() + 5000;
    while (app.pool.stats().running > 0 && Date.now() < stopped) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(app.pool.stats().running).toBe(0);
  });

  it('runs two requests at the same time in two threads', async () => {
    const { url } = await start({ PNM_JOB_TIMEOUT: '1.5', PNM_WORKERS: '2' });
    const started = Date.now();
    const both = await Promise.all([
      postJson(url, '/api/v1/analyze', { net: slowNet() }),
      postJson(url, '/api/v1/analyze', { net: slowNet() }),
    ]);
    expect(both.map((r) => r.status)).toEqual([504, 504]);
    // In sequence this would take 3 s plus; in parallel about 1.5 s plus the start of the threads.
    expect(Date.now() - started).toBeLessThan(2900);
  });
});

describe('the answers carry no secrets and are not cached', () => {
  it('does not cache API answers', async () => {
    const { url } = await start();
    const response = await postJson(url, '/api/v1/validate', netOf('traffic-light'));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('logs the jobs that fail unexpectedly without the content of the request', async () => {
    const { url, logs } = await start();
    await postJson(url, '/api/v1/validate', { net: netOf('traffic-light'), note: 'x' });
    expect(logs.lines.join('\n')).not.toContain('Traffic');
  });
});
