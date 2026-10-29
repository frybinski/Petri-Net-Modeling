import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers';

/**
 * GitLab is not available where the repository is developed, so `.gitlab-ci.yml` cannot be
 * linted by GitLab. These tests check its structure against the documented keywords and the
 * mistakes that are easy to make by hand; the first run of the pipeline in GitLab is the real
 * test (Build > Pipeline editor > Validate). The GitHub workflows and the Compose files get the
 * same kind of check.
 */

type Doc = Record<string, unknown>;

const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');
const load = (path: string): Doc => parse(read(path)) as Doc;

const isObject = (value: unknown): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// --- GitLab CI ----------------------------------------------------------------------------------

const GLOBAL_KEYWORDS = ['default', 'include', 'stages', 'variables', 'workflow', 'spec'];
const JOB_KEYWORDS = [
  'after_script',
  'allow_failure',
  'artifacts',
  'before_script',
  'cache',
  'coverage',
  'dependencies',
  'environment',
  'extends',
  'id_tokens',
  'image',
  'inherit',
  'interruptible',
  'needs',
  'parallel',
  'release',
  'resource_group',
  'retry',
  'rules',
  'script',
  'secrets',
  'services',
  'stage',
  'tags',
  'timeout',
  'trigger',
  'variables',
  'when',
];
const RULE_KEYWORDS = ['if', 'changes', 'exists', 'when', 'allow_failure', 'variables', 'needs'];
const ARTIFACT_KEYWORDS = [
  'paths',
  'exclude',
  'expire_in',
  'expose_as',
  'name',
  'public',
  'reports',
  'untracked',
  'when',
  'access',
];
const WHEN_VALUES = ['on_success', 'on_failure', 'always', 'never', 'manual', 'delayed'];
/** The predefined variables that the file may use; a name that is not here is probably a typo. */
const PREDEFINED = new Set([
  'CI_COMMIT_BRANCH',
  'CI_COMMIT_REF_NAME',
  'CI_COMMIT_SHA',
  'CI_COMMIT_SHORT_SHA',
  'CI_COMMIT_TAG',
  'CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX',
  'CI_JOB_TOKEN',
  'CI_OPEN_MERGE_REQUESTS',
  'CI_PIPELINE_SOURCE',
  'CI_PROJECT_DIR',
  'CI_REGISTRY',
  'CI_REGISTRY_IMAGE',
  'CI_REGISTRY_PASSWORD',
  'CI_REGISTRY_USER',
]);

/** Checks the grammar of an expression after `if:`; returns the problems found. */
export function checkExpression(expression: string): string[] {
  const problems: string[] = [];
  if (expression.trim() === '') return ['the expression is empty'];
  let depth = 0;
  let rest = expression;
  const token =
    /^\s*(?:(\$[A-Za-z_][A-Za-z0-9_]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\/(?:[^/\\]|\\.)+\/[a-z]*)|(==|!=|=~|!~|&&|\|\|)|(\()|(\))|(null))/;
  let previous = 'start';
  let lastOperator = '';
  while (rest.trim() !== '') {
    const match = token.exec(rest);
    if (!match) return [...problems, `cannot read "${rest.trim().slice(0, 30)}"`];
    const kind = match[1]
      ? 'variable'
      : match[2]
        ? 'string'
        : match[3]
          ? 'regex'
          : match[4]
            ? 'operator'
            : match[5]
              ? 'open'
              : match[6]
                ? 'close'
                : 'null';
    if (kind === 'open') depth += 1;
    if (kind === 'close') depth -= 1;
    if (depth < 0) problems.push('a closing parenthesis has no opening one');
    if (kind === 'regex' && !(previous === 'operator' && /^(=~|!~)$/.test(lastOperator))) {
      problems.push('a regular expression is only valid after =~ or !~');
    }
    if (kind === 'operator') {
      if (previous === 'operator' || previous === 'start' || previous === 'open') {
        problems.push(`the operator ${match[4]} has nothing before it`);
      }
      lastOperator = match[4] ?? '';
    }
    previous = kind;
    rest = rest.slice(match[0].length);
  }
  if (depth !== 0) problems.push('the parentheses do not match');
  if (previous === 'operator') problems.push('the expression ends with an operator');
  return problems;
}

function checkRules(rules: unknown, where: string): string[] {
  const problems: string[] = [];
  if (!Array.isArray(rules) || rules.length === 0) return [`${where}: rules must be a list`];
  rules.forEach((rule, index) => {
    const at = `${where}.rules[${index}]`;
    if (!isObject(rule)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYWORDS.includes(key)) problems.push(`${at}: unknown keyword ${key}`);
    }
    if (rule['if'] !== undefined) {
      if (typeof rule['if'] !== 'string') problems.push(`${at}.if must be a string`);
      else for (const p of checkExpression(rule['if'])) problems.push(`${at}.if: ${p}`);
    }
    if (rule['when'] !== undefined && !WHEN_VALUES.includes(String(rule['when']))) {
      problems.push(`${at}.when must be one of ${WHEN_VALUES.join(', ')}`);
    }
  });
  return problems;
}

const scriptLines = (value: unknown): string[] | null => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((line) => typeof line === 'string'))
    return value as string[];
  return null;
};

/** Validates the structure of a `.gitlab-ci.yml` document; returns the problems found. */
export function validateGitlabCi(doc: Doc): string[] {
  const problems: string[] = [];
  const stages = doc['stages'];
  if (
    !Array.isArray(stages) ||
    stages.length === 0 ||
    !stages.every((s) => typeof s === 'string')
  ) {
    problems.push('stages must be a list of names');
    return problems;
  }
  const stageIndex = new Map((stages as string[]).map((name, index) => [name, index]));
  if (isObject(doc['variables'])) {
    for (const [name, value] of Object.entries(doc['variables'])) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        problems.push(`variables.${name}: not a valid name`);
      if (!(typeof value === 'string' || typeof value === 'number' || isObject(value))) {
        problems.push(`variables.${name} must be a string, a number or an object with a value`);
      }
    }
  }
  if (doc['workflow'] !== undefined) {
    const workflow = doc['workflow'];
    if (!isObject(workflow)) problems.push('workflow must be an object');
    else problems.push(...checkRules(workflow['rules'], 'workflow'));
  }

  const jobs = Object.entries(doc).filter(
    ([name]) => !GLOBAL_KEYWORDS.includes(name) && !name.startsWith('.'),
  );
  if (jobs.length === 0) problems.push('there is no job');
  const jobNames = new Set(jobs.map(([name]) => name));
  for (const [name, job] of jobs) {
    if (!isObject(job)) {
      problems.push(`${name}: a job must be an object`);
      continue;
    }
    for (const key of Object.keys(job)) {
      if (!JOB_KEYWORDS.includes(key)) problems.push(`${name}: unknown keyword ${key}`);
    }
    const lines = scriptLines(job['script']);
    if (lines === null || lines.length === 0)
      problems.push(`${name}: script must be a list of commands`);
    const stage = job['stage'];
    if (typeof stage !== 'string' || !stageIndex.has(stage)) {
      problems.push(`${name}: stage ${String(stage)} is not in stages`);
    }
    const image = job['image'];
    if (image !== undefined) {
      const ok =
        typeof image === 'string' ||
        (isObject(image) &&
          typeof image['name'] === 'string' &&
          (image['entrypoint'] === undefined || Array.isArray(image['entrypoint'])));
      if (!ok) problems.push(`${name}: image must be a name or { name, entrypoint }`);
    }
    for (const hook of ['before_script', 'after_script']) {
      if (job[hook] !== undefined && scriptLines(job[hook]) === null) {
        problems.push(`${name}: ${hook} must be a list of commands`);
      }
    }
    if (job['rules'] !== undefined) problems.push(...checkRules(job['rules'], name));
    if (job['when'] !== undefined && !WHEN_VALUES.includes(String(job['when']))) {
      problems.push(`${name}: when must be one of ${WHEN_VALUES.join(', ')}`);
    }
    if (job['needs'] !== undefined) {
      const needs = job['needs'];
      if (!Array.isArray(needs)) problems.push(`${name}: needs must be a list`);
      else {
        for (const need of needs) {
          const target =
            typeof need === 'string' ? need : isObject(need) ? String(need['job']) : '';
          if (!jobNames.has(target)) problems.push(`${name}: needs ${target}, which is not a job`);
          else {
            const targetStage = (jobs.find(([n]) => n === target)?.[1] as Doc | undefined)?.[
              'stage'
            ];
            if (
              (stageIndex.get(String(targetStage)) ?? 99) >= (stageIndex.get(String(stage)) ?? 0)
            ) {
              problems.push(`${name}: needs ${target}, which is not in an earlier stage`);
            }
          }
        }
      }
    }
    const cache = job['cache'];
    if (cache !== undefined) {
      if (!isObject(cache) || !Array.isArray(cache['paths']))
        problems.push(`${name}: cache needs paths`);
      else if (cache['key'] === undefined) problems.push(`${name}: cache needs a key`);
    }
    const artifacts = job['artifacts'];
    if (artifacts !== undefined) {
      if (!isObject(artifacts)) problems.push(`${name}: artifacts must be an object`);
      else {
        for (const key of Object.keys(artifacts)) {
          if (!ARTIFACT_KEYWORDS.includes(key))
            problems.push(`${name}: artifacts: unknown keyword ${key}`);
        }
        if (artifacts['paths'] !== undefined && !Array.isArray(artifacts['paths'])) {
          problems.push(`${name}: artifacts.paths must be a list`);
        }
      }
    }
  }
  return problems;
}

/** The variables of the form $CI_… and ${CI_…} that a text uses. */
function ciVariables(text: string): string[] {
  return [...text.matchAll(/\$\{?(CI_[A-Z0-9_]+)/g)].map((m) => m[1]!);
}

describe('.gitlab-ci.yml', () => {
  const text = read('.gitlab-ci.yml');
  const doc = load('.gitlab-ci.yml');

  it('is valid YAML with the structure of a GitLab pipeline', () => {
    expect(validateGitlabCi(doc)).toEqual([]);
  });

  it('has stages in the order check, image, publish', () => {
    expect(doc['stages']).toEqual(['check', 'image', 'publish']);
  });

  it('only uses predefined variables that exist', () => {
    const used = new Set(ciVariables(text));
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(PREDEFINED.has(name), `$${name}`).toBe(true);
  });

  it('runs lint, format, typecheck, the tests and the build before any image', () => {
    const check = doc['check'] as Doc;
    const script = (check['script'] as string[]).join('\n');
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm lint',
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm test',
      'pnpm test:scripts',
      'pnpm build',
    ]) {
      expect(script, command).toContain(command);
    }
    for (const job of ['image-build', 'image-publish']) {
      expect((doc[job] as Doc)['needs'], job).toEqual(['check']);
    }
  });

  it('builds the image from deploy/Dockerfile with kaniko, which needs no privileged runner', () => {
    for (const name of ['image-build', 'image-publish']) {
      const job = doc[name] as Doc;
      const image = job['image'] as Doc;
      expect(String(image['name']), name).toContain('$KANIKO_IMAGE');
      // The debug image of kaniko has a shell; its entrypoint is the executor itself.
      expect(image['entrypoint'], name).toEqual(['']);
      const script = (job['script'] as string[]).join('\n');
      expect(script, name).toContain('/kaniko/executor');
      expect(script, name).toContain('deploy/Dockerfile');
      expect(script, name).not.toMatch(/--insecure|--skip-tls-verify|privileged/);
    }
    expect(String(doc['variables'] && (doc['variables'] as Doc)['KANIKO_IMAGE'])).toMatch(/kaniko/);
  });

  it('builds without pushing on branches and merge requests', () => {
    const job = doc['image-build'] as Doc;
    const script = (job['script'] as string[]).join('\n');
    expect(script).toContain('--no-push');
    expect(script).not.toContain('--destination');
    expect(JSON.stringify(job['rules'])).toContain('never');
  });

  it('pushes only from a version tag, to the registry of the project, with the job token', () => {
    const job = doc['image-publish'] as Doc;
    const rules = job['rules'] as Array<Doc>;
    expect(rules).toHaveLength(1);
    expect(String(rules[0]?.['if'])).toMatch(/^\$CI_COMMIT_TAG =~ \/\^v/);
    const script = (job['script'] as string[]).join('\n');
    expect(script).toContain('--destination $CI_REGISTRY_IMAGE:$VERSION');
    expect(script).toContain('$CI_COMMIT_SHORT_SHA');
    expect(script).toContain('CI_REGISTRY_USER');
    expect(script).toContain('CI_REGISTRY_PASSWORD');
    // "latest" only for a release, and the tag has to name the version of the code.
    expect(script).toMatch(/case "\$VERSION" in \*-\*\)/);
    expect(script).toContain('package.json');
    expect((job['artifacts'] as Doc)['paths']).toEqual(['image.txt']);
  });

  it('matches the tags of releases and pre-releases, nothing else', () => {
    const rule = String(((doc['image-publish'] as Doc)['rules'] as Array<Doc>)[0]?.['if']);
    const pattern = /=~ \/(.*)\/$/.exec(rule)?.[1];
    expect(pattern).toBeDefined();
    const regex = new RegExp(pattern!);
    for (const tag of ['v1.2.0', 'v10.20.30', 'v1.2.0-rc.1', 'v1.2.0-beta'])
      expect(regex.test(tag), tag).toBe(true);
    for (const tag of ['1.2.0', 'v1.2', 'v1.2.0.1', 'latest', 'release-1', 'v1.2.0-'])
      expect(regex.test(tag), tag).toBe(false);
  });

  it('holds no secret', () => {
    expect(text).not.toMatch(/glpat-|ghp_|-----BEGIN|password\s*[:=]\s*['"]?[A-Za-z0-9]{8,}/i);
  });

  it('is caught by the validator when something is wrong', () => {
    const broken = structuredClone(doc);
    (broken['check'] as Doc)['stage'] = 'nowhere';
    (broken['image-build'] as Doc)['needs'] = ['nothing'];
    (broken['image-publish'] as Doc)['colour'] = 'red';
    (broken['image-publish'] as Doc)['rules'] = [
      { if: '$CI_COMMIT_TAG =~ /^v/ &&', when: 'sometimes' },
    ];
    delete (broken['image-build'] as Doc)['script'];
    const problems = validateGitlabCi(broken);
    expect(problems.join('\n')).toContain('stage nowhere is not in stages');
    expect(problems.join('\n')).toContain('needs nothing, which is not a job');
    expect(problems.join('\n')).toContain('unknown keyword colour');
    expect(problems.join('\n')).toContain('ends with an operator');
    expect(problems.join('\n')).toContain('when must be one of');
    expect(problems.join('\n')).toContain('image-build: script must be a list');
  });
});

describe('the expressions of rules', () => {
  it('accepts the forms that GitLab knows', () => {
    for (const expression of [
      '$CI_COMMIT_TAG',
      '$CI_PIPELINE_SOURCE == "merge_request_event"',
      '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS && $CI_PIPELINE_SOURCE == "push"',
      '$CI_COMMIT_TAG =~ /^v\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$/',
      '($A == "x" || $B != null) && $C',
    ]) {
      expect(checkExpression(expression), expression).toEqual([]);
    }
  });

  it('finds the usual mistakes', () => {
    expect(checkExpression('')).not.toEqual([]);
    expect(checkExpression('$A ==')).not.toEqual([]);
    expect(checkExpression('== $A')).not.toEqual([]);
    expect(checkExpression('($A == "x"')).not.toEqual([]);
    expect(checkExpression('$A == "x")')).not.toEqual([]);
    expect(checkExpression('$A == "x')).not.toEqual([]);
    expect(checkExpression('A == "x"')).not.toEqual([]);
    expect(checkExpression('$A == /x/')).not.toEqual([]);
    expect(checkExpression('/x/ =~ $A')).not.toEqual([]);
  });
});

// --- GitHub Actions ---------------------------------------------------------------------------

type Step = Doc & { uses?: string; run?: string; name?: string; with?: Doc; env?: Doc };

function jobsOf(path: string): Record<string, Doc & { steps: Step[] }> {
  return load(path)['jobs'] as Record<string, Doc & { steps: Step[] }>;
}

describe('the GitHub workflows', () => {
  const workflows = readdirSync(join(REPO, '.github', 'workflows')).filter((f) =>
    f.endsWith('.yml'),
  );

  it('are valid YAML with a name, a trigger and jobs that have steps', () => {
    expect(workflows.sort()).toEqual(['ci.yml', 'deploy.yml', 'image.yml', 'release.yml']);
    for (const file of workflows) {
      const doc = load(`.github/workflows/${file}`);
      expect(typeof doc['name'], file).toBe('string');
      // YAML 1.1 reads `on` as a boolean; the yaml package (1.2) keeps the key.
      expect(doc['on'], file).toBeDefined();
      for (const [name, job] of Object.entries(doc['jobs'] as Record<string, Doc>)) {
        expect(Array.isArray(job['steps']), `${file}: ${name}`).toBe(true);
        expect(typeof job['runs-on'], `${file}: ${name}`).toBe('string');
        for (const step of job['steps'] as Step[]) {
          expect(step.uses !== undefined || step.run !== undefined, `${file}: ${name}`).toBe(true);
        }
      }
    }
  });

  it('use no token that is written into a file', () => {
    for (const file of workflows) {
      expect(read(`.github/workflows/${file}`), file).not.toMatch(/glpat-|ghp_|-----BEGIN/);
    }
  });

  it('image.yml does nothing unless KIT_REGISTRY_IMAGE is set, and then pushes the tags of the plan', () => {
    const text = read('.github/workflows/image.yml');
    const doc = load('.github/workflows/image.yml');
    const job = jobsOf('.github/workflows/image.yml')['image']!;
    expect(String(job['if'])).toContain("vars.KIT_REGISTRY_IMAGE != ''");
    const on = doc['on'] as Doc;
    expect((on['push'] as Doc)['tags']).toEqual(['v*']);
    expect(on['workflow_dispatch']).toBeDefined();
    // The credentials come from secrets, the target from a variable.
    expect(text).toContain('secrets.KIT_REGISTRY_USER');
    expect(text).toContain('secrets.KIT_REGISTRY_TOKEN');
    expect(text).toContain('vars.KIT_REGISTRY_IMAGE');
    const push = job.steps.find((step) => step.uses?.startsWith('docker/build-push-action'));
    expect(push?.with?.['file']).toBe('deploy/Dockerfile');
    const login = job.steps.find((step) => step.uses?.startsWith('docker/login-action'));
    expect(login?.with?.['registry']).toContain('steps.version.outputs.registry');
    // Tests before the image, as in the release workflow.
    const runs = job.steps.map((step) => step.run ?? '').join('\n');
    for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
      expect(runs, command).toContain(command);
    }
    expect(text).toContain('${version}-${short_sha}');
    expect(text).toContain(':latest');
  });

  it('ci.yml builds the image on every push and pull request without pushing it', () => {
    const doc = load('.github/workflows/ci.yml');
    const on = doc['on'] as Doc;
    expect(on['push']).toBeDefined();
    expect(on['pull_request']).toBeDefined();
    const job = jobsOf('.github/workflows/ci.yml')['image']!;
    const build = job.steps.find((step) => step.uses?.startsWith('docker/build-push-action'));
    expect(build?.with?.['file']).toBe('deploy/Dockerfile');
    expect(build?.with?.['push']).toBe(false);
    expect(job.steps.map((s) => s.run ?? '').join('\n')).toContain('deploy/smoke-test.sh');
  });
});

// --- Compose and the Dockerfile ---------------------------------------------------------------

describe('deploy/compose.yaml', () => {
  const doc = load('deploy/compose.yaml');
  const service = (doc['services'] as Record<string, Doc>)['pnm']!;

  it('uses a fixed version of the image from the registry and builds nothing', () => {
    expect(String(service['image'])).toMatch(/^\$\{PNM_IMAGE:\?[^}]*\}:\$\{PNM_VERSION:\?[^}]*\}$/);
    expect(service['build']).toBeUndefined();
    expect(read('deploy/compose.yaml')).not.toMatch(/PNM_VERSION:-latest|:latest/);
  });

  it('publishes no port and joins the network of the ingress, which is external', () => {
    expect(service['ports']).toBeUndefined();
    expect(service['networks']).toEqual(['ingress']);
    const networks = doc['networks'] as Record<string, Doc>;
    expect(networks['ingress']?.['external']).toBe(true);
    expect(String(networks['ingress']?.['name'])).toContain('PNM_INGRESS_NETWORK');
  });

  it('keeps the data in a volume, restarts, and is locked down', () => {
    expect(service['volumes']).toEqual(['pnm-data:/data']);
    expect(service['restart']).toBe('unless-stopped');
    expect(service['read_only']).toBe(true);
    expect(service['cap_drop']).toEqual(['ALL']);
    expect(service['security_opt']).toEqual(['no-new-privileges:true']);
    expect(service['mem_limit']).toBeDefined();
    expect(service['cpus']).toBeDefined();
    expect(service['extra_hosts']).toEqual(['host.docker.internal:host-gateway']);
  });

  it('passes every PNM_ variable of the server that an operator may set', () => {
    const passed = Object.keys(service['environment'] as Doc);
    for (const name of [
      'PNM_PUBLIC_URL',
      'PNM_LLM_BASE_URL',
      'PNM_LLM_API_KEY',
      'PNM_LLM_MODELS',
      'PNM_LLM_DEFAULT_MODEL',
      'PNM_ALLOWED_NETS',
      'PNM_TRUSTED_PROXIES',
      'PNM_BASIC_AUTH',
    ]) {
      expect(passed, name).toContain(name);
    }
    // The port and the folders are those of the image; changing them would break the health check.
    expect(passed).not.toContain('PNM_PORT');
    expect(passed).not.toContain('PNM_DATA_DIR');
  });
});

describe('the Compose overlays and the local file', () => {
  it('compose.traefik.yaml has the labels of a router, a source filter and the service port', () => {
    const labels = (load('deploy/compose.traefik.yaml')['services'] as Record<string, Doc>)[
      'pnm'
    ]?.['labels'] as string[];
    const text = labels.join('\n');
    expect(text).toContain('traefik.enable=true');
    expect(text).toContain('traefik.http.routers.pnm.rule=Host(`${PNM_HOST');
    expect(text).toContain('traefik.http.services.pnm.loadbalancer.server.port=8080');
    expect(text).toContain('ipallowlist.sourcerange');
    expect(text).toContain('traefik.docker.network=${PNM_INGRESS_NETWORK}');
  });

  it('compose.ollama-network.yaml joins an external network next to the ingress', () => {
    const doc = load('deploy/compose.ollama-network.yaml');
    expect((doc['services'] as Record<string, Doc>)['pnm']?.['networks']).toEqual([
      'ingress',
      'ollama',
    ]);
    expect((doc['networks'] as Record<string, Doc>)['ollama']?.['external']).toBe(true);
  });

  it('compose.local.yaml builds from the source, listens on localhost only and starts the fake model server', () => {
    const doc = load('deploy/compose.local.yaml');
    const services = doc['services'] as Record<string, Doc>;
    expect(services['pnm']?.['ports']).toEqual(['127.0.0.1:8080:8080']);
    expect((services['pnm']?.['build'] as Doc)['dockerfile']).toBe('deploy/Dockerfile');
    expect(services['fake-llm']?.['command']).toEqual(['node', 'fake-llm.js']);
    expect(services['fake-llm']?.['ports']).toBeUndefined();
    expect(String((services['pnm']?.['environment'] as Doc)['PNM_LLM_BASE_URL'])).toContain(
      'fake-llm',
    );
  });

  it('.env.example names every variable that the compose files read, and holds no key', () => {
    const example = read('deploy/.env.example');
    const active = new Set([...example.matchAll(/^#?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    for (const file of ['compose.yaml', 'compose.traefik.yaml', 'compose.ollama-network.yaml']) {
      for (const match of read(`deploy/${file}`).matchAll(/\$\{(PNM_[A-Z0-9_]+)/g)) {
        expect(active.has(match[1]!), `${match[1]} (used in ${file})`).toBe(true);
      }
    }
    expect(example).toMatch(/^PNM_LLM_API_KEY=$/m);
    expect(example).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });

  it('.env.example and docs/server.md document every setting of the server', () => {
    const settings = [...read('apps/server/src/config.ts').matchAll(/^\s+(PNM_[A-Z0-9_]+):/gm)].map(
      (m) => m[1]!,
    );
    expect(settings.length).toBeGreaterThan(20);
    const example = read('deploy/.env.example');
    const reference = existsSync(join(REPO, 'docs', 'server.md')) ? read('docs/server.md') : null;
    for (const name of settings) {
      // The port and the folders belong to the image; the other settings are in the example.
      if (
        ![
          'PNM_PORT',
          'PNM_BIND_ADDRESS',
          'PNM_WEB_DIR',
          'PNM_DATA_DIR',
          'PNM_LLM_CONCURRENCY',
          'PNM_LLM_QUEUE',
          'PNM_LLM_MAX_BODY',
          'PNM_JOB_QUEUE',
        ].includes(name)
      ) {
        expect(example, name).toContain(name);
      }
      if (reference !== null) expect(reference, name).toContain(name);
    }
  });
});

describe('deploy/Dockerfile', () => {
  const text = read('deploy/Dockerfile');
  const instructions = text.split('\n').filter((line) => /^[A-Z]+\s/.test(line));

  it('is a multi-stage build on one configurable base image', () => {
    expect(instructions.filter((l) => l.startsWith('FROM '))).toEqual([
      'FROM ${NODE_IMAGE} AS build',
      'FROM ${NODE_IMAGE} AS runtime',
    ]);
    expect(text).toContain('ARG NODE_IMAGE=node:22-alpine');
  });

  it('runs as the user node, listens on 8080, has a health check on /api/health and keeps data in /data', () => {
    expect(text).toMatch(/^USER node$/m);
    expect(text).toMatch(/^EXPOSE 8080$/m);
    expect(text).toMatch(/^HEALTHCHECK .*\\\n\s+CMD wget .*\/api\/health/m);
    expect(text).toContain('chown node:node /data');
    expect(text).toMatch(/^VOLUME \["\/data"\]$/m);
    expect(text).toMatch(/^CMD \["node", "server\.js"\]$/m);
  });

  it('has the labels of the OCI image specification', () => {
    for (const label of ['source', 'version', 'revision', 'licenses', 'title']) {
      expect(text).toContain(`org.opencontainers.image.${label}=`);
    }
  });

  it('uses no feature that kaniko lacks', () => {
    expect(text).not.toMatch(/--mount|--link|<<\s*EOF|^#\s*syntax/m);
  });

  it('copies the manifest of every package before it installs, so that none is forgotten', () => {
    const copied = new Set(
      [...text.matchAll(/^COPY ((?:apps|packages)\/[^/]+)\/package\.json /gm)].map((m) => m[1]),
    );
    const workspace = ['apps', 'packages'].flatMap((dir) =>
      readdirSync(join(REPO, dir), { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && existsSync(join(REPO, dir, entry.name, 'package.json')),
        )
        .map((entry) => `${dir}/${entry.name}`),
    );
    expect([...copied].sort()).toEqual(workspace.sort());
  });

  it('runs the installation with the lock file and builds the web app and the server', () => {
    expect(text).toContain('pnpm install --frozen-lockfile');
    expect(text).toContain('pnpm --filter @pnm/web build');
    expect(text).toContain('pnpm --filter @pnm/server build');
    expect(text).toContain('COPY --from=build /src/apps/web/dist ./web');
    expect(text).toMatch(
      /COPY --from=build \/src\/apps\/server\/dist\/server\.js .*worker\.js .*fake-llm\.js \.\/$/m,
    );
  });

  it('keeps the build output and local files out of the context', () => {
    const ignore = read('.dockerignore');
    for (const entry of ['**/node_modules', '**/dist', '.git', '.env'])
      expect(ignore).toContain(entry);
  });
});

describe('deploy/smoke-test.sh', () => {
  it('is valid shell and executable', () => {
    execFileSync('sh', ['-n', join(REPO, 'deploy', 'smoke-test.sh')]);
    execFileSync('test', ['-x', join(REPO, 'deploy', 'smoke-test.sh')]);
  });
});
