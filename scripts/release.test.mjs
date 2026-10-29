// Tests of the release scripts: `node --test scripts` (also `pnpm test:scripts`).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepare, sha256 } from './release-assets.mjs';
import { absoluteLinks, sectionOf, versionOf } from './release-notes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const notes = join(here, 'release-notes.mjs');

const CHANGELOG = `# Changelog

Intro.

## 1.0.0: Release

Summary of the release.

### Added

- Something.

## 1.0.0-rc.1: Analysis

Release candidate.

## 0.9.0: Interchange

Old.
`;

describe('versionOf', () => {
  it('drops the v of a tag', () => {
    assert.equal(versionOf('v1.0.0'), '1.0.0');
    assert.equal(versionOf('1.0.0'), '1.0.0');
    assert.equal(versionOf(' v1.2.3-rc.1\n'), '1.2.3-rc.1');
  });
});

describe('sectionOf', () => {
  it('returns the section of the version without its heading', () => {
    assert.equal(
      sectionOf(CHANGELOG, '1.0.0'),
      'Summary of the release.\n\n### Added\n\n- Something.',
    );
    assert.equal(sectionOf(CHANGELOG, '0.9.0'), 'Old.');
  });

  it('does not mix up a version with its release candidate', () => {
    assert.equal(sectionOf(CHANGELOG, '1.0.0-rc.1'), 'Release candidate.');
    assert.equal(sectionOf(CHANGELOG, '1.0.0-rc'), null);
    assert.equal(sectionOf(CHANGELOG, '1.0'), null);
  });

  it('returns null for a version that is not there and accepts [1.0.0] headings', () => {
    assert.equal(sectionOf(CHANGELOG, '2.0.0'), null);
    assert.equal(sectionOf('## [1.2.0] - 2026-01-01\n\nBracketed.\n', '1.2.0'), 'Bracketed.');
  });

  it('keeps the subheadings of the section (only level two ends it)', () => {
    assert.match(sectionOf(CHANGELOG, '1.0.0'), /### Added/);
  });

  it('reads the real changelog: every version heading has notes', () => {
    const real = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8');
    const versions = [...real.matchAll(/^## (\d[^:\s]*)/gm)].map((m) => m[1]);
    assert.ok(versions.length >= 8);
    for (const version of versions)
      assert.ok((sectionOf(real, version) ?? '').length > 20, version);
  });
});

describe('absoluteLinks', () => {
  const repo = 'https://github.com/owner/name/';
  it('points relative links at the files at the tag and leaves the others alone', () => {
    const text =
      'See [limits](docs/limitations.md), [adr](./docs/adr/0005.md#x), [site](https://example.org/a), [here](#top) and [mail](mailto:a@b.c).';
    assert.equal(
      absoluteLinks(text, repo, 'v1.0.0'),
      'See [limits](https://github.com/owner/name/blob/v1.0.0/docs/limitations.md), ' +
        '[adr](https://github.com/owner/name/blob/v1.0.0/docs/adr/0005.md#x), ' +
        '[site](https://example.org/a), [here](#top) and [mail](mailto:a@b.c).',
    );
  });
});

describe('release-notes.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pnm-notes-'));
  const file = join(dir, 'CHANGELOG.md');
  writeFileSync(file, CHANGELOG);

  it('prints the notes of a tag', () => {
    const out = execFileSync(process.execPath, [notes, 'v1.0.0', '--changelog', file], {
      encoding: 'utf8',
    });
    assert.equal(out, 'Summary of the release.\n\n### Added\n\n- Something.\n');
  });

  it('makes the links absolute with --repo', () => {
    const linked = join(dir, 'LINKED.md');
    writeFileSync(linked, '## 1.0.0: Release\n\nSee [x](docs/x.md).\n');
    const out = execFileSync(
      process.execPath,
      [notes, '1.0.0', '--changelog', linked, '--repo', 'https://github.com/o/n'],
      { encoding: 'utf8' },
    );
    assert.equal(out, 'See [x](https://github.com/o/n/blob/v1.0.0/docs/x.md).\n');
  });

  it('fails with status 1 for an unknown version and 2 without arguments', () => {
    const missing = spawnSync(process.execPath, [notes, 'v3.0.0', '--changelog', file], {
      encoding: 'utf8',
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no section for version 3\.0\.0/);
    assert.equal(spawnSync(process.execPath, [notes], { encoding: 'utf8' }).status, 2);
  });

  it('fails for an empty section', () => {
    const empty = join(dir, 'EMPTY.md');
    writeFileSync(empty, '# Changelog\n\n## 1.0.0: Nothing\n\n## 0.9.0: Old\n\nText.\n');
    const result = spawnSync(process.execPath, [notes, '1.0.0', '--changelog', empty], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty/);
  });
});

describe('release-assets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pnm-assets-'));
  const bundle = join(dir, 'pnm.js');
  const fake = (version) =>
    `#!/usr/bin/env node\nprocess.stdout.write(process.argv[2] === '--version' ? '${version}\\n' : '');\n`;

  it('copies the bundle under the name of the version and writes a sum that sha256sum accepts', () => {
    writeFileSync(bundle, fake('9.9.9'));
    chmodSync(bundle, 0o755);
    const out = join(dir, 'out');
    const { file, sumFile, sum } = prepare({ version: '9.9.9', outDir: out, bundle });
    assert.equal(file, join(out, 'pnm-9.9.9.js'));
    assert.equal(sum, sha256(bundle));
    assert.equal(readFileSync(sumFile, 'utf8'), `${sum}  pnm-9.9.9.js\n`);
    assert.equal(readFileSync(file, 'utf8'), readFileSync(bundle, 'utf8'));
  });

  it('refuses a bundle of another version and a file that is not the bundle', () => {
    writeFileSync(bundle, fake('1.0.0'));
    assert.throws(
      () => prepare({ version: '2.0.0', outDir: join(dir, 'o2'), bundle }),
      /reports version 1\.0\.0, not 2\.0\.0/,
    );
    writeFileSync(bundle, 'console.log("x")\n');
    assert.throws(() => prepare({ version: '1.0.0', outDir: join(dir, 'o3'), bundle }), /shebang/);
  });
});
