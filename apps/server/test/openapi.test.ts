import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/api/openapi';
import { startApp, type RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

type Operation = {
  summary?: string;
  responses?: Record<string, unknown>;
  parameters?: Array<{ name: string; in: string }>;
  requestBody?: { content: Record<string, { schema: { $ref?: string } }> };
};
type Doc = {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};

/** `/api/v1/projects/:id` as OpenAPI writes it. */
const openApiPath = (pattern: string): string => pattern.replace(/:(\w+)/g, '{$1}');

async function documented(): Promise<{ doc: Doc; app: RunningApp }> {
  running = await startApp();
  const response = await fetch(`${running.url}/api/v1/openapi.json`);
  expect(response.status).toBe(200);
  return { doc: (await response.json()) as Doc, app: running };
}

describe('the OpenAPI description', () => {
  it('is served at /api/v1/openapi.json', async () => {
    const { doc } = await documented();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toEqual(expect.any(String));
    expect(Object.keys(doc.paths).length).toBeGreaterThan(10);
  });

  it('describes every route of the interface, and only routes that exist', async () => {
    const { doc, app } = await documented();
    const routes = app.app.router
      .routes()
      .filter((route) => route.pattern.startsWith('/api/') || route.pattern.startsWith('/llm/'))
      .map((route) => `${route.method.toLowerCase()} ${openApiPath(route.pattern)}`)
      .sort();
    const operations = Object.entries(doc.paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`))
      .sort();
    expect(operations).toEqual(routes);
  });

  it('gives every operation a summary, answers and its path parameters', async () => {
    const { doc, app } = await documented();
    for (const route of app.app.router.routes()) {
      if (!route.pattern.startsWith('/api/') && !route.pattern.startsWith('/llm/')) continue;
      const operation = doc.paths[openApiPath(route.pattern)]?.[route.method.toLowerCase()];
      const label = `${route.method} ${route.pattern}`;
      expect(operation?.summary, label).toEqual(expect.any(String));
      expect(Object.keys(operation?.responses ?? {}).length, label).toBeGreaterThan(0);
      const names = [...route.pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const declared = (operation?.parameters ?? [])
        .filter((p) => p.in === 'path')
        .map((p) => p.name);
      expect(declared.sort(), label).toEqual(names.sort());
    }
  });

  it('has every schema that it points to', async () => {
    const { doc } = await documented();
    const text = JSON.stringify(doc);
    const refs = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const name of new Set(refs)) {
      expect(doc.components.schemas[name], name).toBeDefined();
    }
  });

  it('has request schemas that match what the server accepts', async () => {
    const { doc } = await documented();
    const simulate = doc.components.schemas['SimulateRequest'] as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(simulate.properties).sort()).toEqual([
      'formats',
      'maxEvents',
      'net',
      'rates',
      'seconds',
      'seed',
      'startTime',
      'warmup',
    ]);
    expect(simulate.required).toEqual(['net']);
    expect(simulate.additionalProperties).toBe(false);
  });

  it('uses the public address as the server', () => {
    const doc = buildOpenApi({ publicUrl: 'https://pnm.example.org' }) as {
      servers: Array<{ url: string }>;
    };
    expect(doc.servers).toEqual([{ url: 'https://pnm.example.org' }]);
  });
});
