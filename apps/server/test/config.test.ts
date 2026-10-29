import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/basic-auth';
import {
  ConfigError,
  DEFAULT_ALLOWED_NETS,
  describeConfig,
  loadConfig,
  parseSize,
} from '../src/config';

const minimal = { PNM_PUBLIC_URL: 'https://pnm.example.org/' };

describe('parseSize', () => {
  it('reads sizes with units and plain bytes', () => {
    expect(parseSize('10mb')).toBe(10 * 1024 * 1024);
    expect(parseSize('2 MB')).toBe(2 * 1024 * 1024);
    expect(parseSize('512kb')).toBe(512 * 1024);
    expect(parseSize('1.5m')).toBe(1.5 * 1024 * 1024);
    expect(parseSize('2048')).toBe(2048);
    expect(parseSize('1g')).toBe(1024 ** 3);
  });

  it('rejects anything else', () => {
    expect(parseSize('')).toBeNull();
    expect(parseSize('big')).toBeNull();
    expect(parseSize('-1mb')).toBeNull();
    expect(parseSize('10 parsecs')).toBeNull();
  });
});

describe('loadConfig', () => {
  it('needs only the public address and fills in the defaults of the plan', () => {
    const config = loadConfig(minimal);
    expect(config).toMatchObject({
      port: 8080,
      publicUrl: 'https://pnm.example.org',
      serverName: 'pnm.example.org',
      dataDir: '/data',
      maxBody: 10 * 1024 * 1024,
      allowedNets: [...DEFAULT_ALLOWED_NETS],
      trustedProxies: [],
      allowedHosts: [],
      jobs: { workers: 2, timeoutMs: 60_000 },
      projects: { maxVersions: 200, trashDays: 30 },
    });
    expect(config.llm).toMatchObject({
      baseUrl: null,
      apiKey: null,
      models: [],
      timeoutMs: 180_000,
      concurrency: 2,
      maxQueue: 10,
      maxBody: 2 * 1024 * 1024,
    });
    expect(config.basicAuth).toEqual([]);
  });

  it('explains a missing public address', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (error) {
      expect((error as ConfigError).problems).toEqual([
        expect.stringContaining('PNM_PUBLIC_URL is required'),
      ]);
    }
  });

  it('treats empty values like unset ones, as Compose passes them', () => {
    const config = loadConfig({
      ...minimal,
      PNM_LLM_BASE_URL: '',
      PNM_LLM_API_KEY: '',
      PNM_LLM_MODELS: '',
      PNM_BASIC_AUTH: '  ',
      PNM_PORT: '',
    });
    expect(config.llm.baseUrl).toBeNull();
    expect(config.port).toBe(8080);
  });

  it('reads the language model settings', () => {
    const config = loadConfig({
      ...minimal,
      PNM_LLM_BASE_URL: 'https://ollama-webui.example.org/api/',
      PNM_LLM_API_KEY: 'placeholder-key',
      PNM_LLM_MODELS: 'llama3.1:8b, qwen2.5:14b',
      PNM_LLM_TIMEOUT: '30',
    });
    expect(config.llm).toMatchObject({
      baseUrl: 'https://ollama-webui.example.org/api',
      apiKey: 'placeholder-key',
      models: ['llama3.1:8b', 'qwen2.5:14b'],
      defaultModel: 'llama3.1:8b',
      timeoutMs: 30_000,
    });
  });

  it('lists every problem at once', () => {
    try {
      loadConfig({
        PNM_PUBLIC_URL: 'ftp://nope',
        PNM_PORT: '99999',
        PNM_MAX_BODY: 'huge',
        PNM_ALLOWED_NETS: '10.0.0.0/8,banana',
        PNM_TRUSTED_PROXIES: '10.0.0.0/40',
        PNM_BASIC_AUTH: 'someone:plain',
        PNM_LLM_API_KEY: 'key',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const text = (error as ConfigError).message;
      for (const name of ['PNM_PUBLIC_URL', 'PNM_PORT', 'PNM_MAX_BODY']) {
        expect(text).toContain(name);
      }
    }
    try {
      loadConfig({
        ...minimal,
        PNM_ALLOWED_NETS: '10.0.0.0/8,banana',
        PNM_TRUSTED_PROXIES: '10.0.0.0/40',
        PNM_BASIC_AUTH: 'someone:plain',
        PNM_LLM_API_KEY: 'key',
        PNM_LLM_MODELS: 'a,b',
        PNM_LLM_BASE_URL: 'http://llm:11434/v1',
        PNM_LLM_DEFAULT_MODEL: 'c',
      });
      expect.unreachable();
    } catch (error) {
      const problems = (error as ConfigError).problems;
      expect(problems).toHaveLength(4);
      expect(problems.join('\n')).toContain('PNM_ALLOWED_NETS: "banana"');
      expect(problems.join('\n')).toContain('PNM_TRUSTED_PROXIES: "10.0.0.0/40"');
      expect(problems.join('\n')).toContain('PNM_BASIC_AUTH');
      expect(problems.join('\n')).toContain('PNM_LLM_DEFAULT_MODEL');
    }
  });

  it('wants a base URL when there is a key', () => {
    expect(() => loadConfig({ ...minimal, PNM_LLM_API_KEY: 'key' })).toThrow(/PNM_LLM_BASE_URL/);
  });

  it('accepts password entries made by hashPassword', () => {
    const entry = hashPassword('alice', 'correct horse');
    expect(loadConfig({ ...minimal, PNM_BASIC_AUTH: entry }).basicAuth).toHaveLength(1);
  });

  it('describes the settings without the key and without hashes', () => {
    const entry = hashPassword('alice', 'pw');
    const text = JSON.stringify(
      describeConfig(
        loadConfig({
          ...minimal,
          PNM_LLM_BASE_URL: 'http://llm:11434/v1',
          PNM_LLM_API_KEY: 'super-secret-placeholder',
          PNM_BASIC_AUTH: entry,
        }),
      ),
    );
    expect(text).not.toContain('super-secret-placeholder');
    expect(text).not.toContain(entry.split(':')[3]);
    expect(text).toContain('"apiKey":"set"');
  });
});
