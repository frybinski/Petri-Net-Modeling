#!/usr/bin/env node
// Prints the release notes of a version: the section of CHANGELOG.md that belongs to it, without
// its heading. The release workflow uses this for the text of the GitHub release.
//
//   node scripts/release-notes.mjs v1.0.0            (a tag, with or without the leading v)
//   node scripts/release-notes.mjs 1.0.0 --changelog path/to/CHANGELOG.md
//   node scripts/release-notes.mjs v1.0.0 --repo https://github.com/owner/name
//
// With `--repo` the links to files of the repository (`docs/x.md`) become absolute links to the
// files at the tag (`<repo>/blob/v<version>/docs/x.md`), because a relative link does not work in
// the text of a release.
//
// The headings of the changelog look like `## 1.0.0: Title`. The version must match exactly, so
// `1.0.0` never picks up `1.0.0-rc.1`. Exit status 1 if there is no such section or it is empty.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The version in a tag name or a version: `v1.0.0` and `1.0.0` both give `1.0.0`. */
export function versionOf(name) {
  return name.trim().replace(/^v/, '');
}

/**
 * The section of a changelog for a version, trimmed, without the line with its heading. `null` if
 * the changelog has no heading for the version.
 */
export function sectionOf(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = (line) => /^## /.test(line);
  const wanted = (line) => {
    const match = /^## \[?([^\]:\s]+)\]?(?::|\s|$)/.exec(line);
    return match !== null && match[1] === version;
  };
  const start = lines.findIndex((line) => heading(line) && wanted(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (heading(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** Makes the relative links of markdown text absolute: they point at the files at a tag. */
export function absoluteLinks(text, repo, tag) {
  const base = `${repo.replace(/\/+$/, '')}/blob/${tag}/`;
  return text.replace(/\]\(([^)\s]+)\)/g, (match, target) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return match;
    return `](${base}${target.replace(/^\.?\//, '')})`;
  });
}

function main(argv) {
  const args = argv.slice(2);
  let changelogPath = join(root, 'CHANGELOG.md');
  let repo = '';
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--changelog') {
      changelogPath = args[(i += 1)] ?? '';
    } else if (args[i] === '--repo') {
      repo = args[(i += 1)] ?? '';
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1 || changelogPath === '') {
    console.error(
      'Usage: node scripts/release-notes.mjs <version|tag> [--changelog <file>] [--repo <url>]',
    );
    return 2;
  }
  const version = versionOf(positional[0]);
  const section = sectionOf(readFileSync(changelogPath, 'utf8'), version);
  if (section === null) {
    console.error(`${changelogPath} has no section for version ${version}.`);
    return 1;
  }
  if (section === '') {
    console.error(`The section for version ${version} in ${changelogPath} is empty.`);
    return 1;
  }
  process.stdout.write(`${repo === '' ? section : absoluteLinks(section, repo, `v${version}`)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
