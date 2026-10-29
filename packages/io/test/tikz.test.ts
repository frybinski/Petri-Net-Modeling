import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TIKZ_MAX_DOTS, texEscape, toTikz } from '../src';

const here = fileURLToPath(new URL('.', import.meta.url));
const examplesDir = join(here, '..', '..', '..', 'examples');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(examplesDir, `${name}.pn.json`), 'utf8'));

/** Counts braces that are not escaped; they must balance. */
function braceBalance(tex: string): number {
  let depth = 0;
  for (let i = 0; i < tex.length; i += 1) {
    const char = tex.charAt(i);
    if (char === '\\') i += 1;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    if (depth < 0) return depth;
  }
  return depth;
}

/** Strips comments and compares the number of `\begin` and `\end`. */
function environmentsBalance(tex: string): boolean {
  const begins = tex.match(/\\begin\{/g)?.length ?? 0;
  const ends = tex.match(/\\end\{/g)?.length ?? 0;
  return begins === ends;
}

function tiny(): PetriNet {
  const net = createEmptyNet('Tiny');
  net.places.push(
    { id: 'p', name: 'Wait', position: { x: 100, y: 300 } },
    { id: 'q', name: 'Done', position: { x: 300, y: 100 } },
  );
  net.transitions.push({ id: 't', name: 'Go', position: { x: 200, y: 200 } });
  net.arcs.push(
    { id: 'a', source: 'p', target: 't', weight: 1 },
    { id: 'b', source: 't', target: 'q', weight: 2 },
  );
  net.marking['p'] = [1, 1, 1];
  return net;
}

describe('toTikz snapshots', () => {
  it('draws the producer/consumer net', async () => {
    await expect(toTikz(example('producer-consumer'))).toMatchFileSnapshot(
      './snapshots/producer-consumer.tex',
    );
  });

  it('draws the order processing net (JSON net with guards and inscriptions)', async () => {
    await expect(toTikz(example('order-processing'))).toMatchFileSnapshot(
      './snapshots/order-processing.tex',
    );
  });

  it('draws the producer/consumer net for a thesis (external styles, ids)', async () => {
    await expect(
      toTikz(example('producer-consumer'), { styles: 'external', labels: 'ids', scale: 0.015 }),
    ).toMatchFileSnapshot('./snapshots/producer-consumer-external.tex');
  });
});

describe('toTikz', () => {
  it('writes a fragment by default', () => {
    const tex = toTikz(tiny());
    expect(tex).not.toContain('\\documentclass');
    expect(tex).toMatch(/\\begin\{tikzpicture\}[^]*\\end\{tikzpicture\}\n$/);
    expect(tex).toContain('\\tikzset{');
  });

  it('writes a complete document with standalone', () => {
    const tex = toTikz(tiny(), { standalone: true });
    const lines = tex.trimEnd().split('\n');
    expect(lines[0]).toBe('\\documentclass[tikz,border=4pt]{standalone}');
    expect(lines).toContain('\\begin{document}');
    expect(lines.at(-1)).toBe('\\end{document}');
    expect(lines.indexOf('\\begin{document}')).toBeLessThan(lines.indexOf('\\begin{tikzpicture}'));
    expect(lines.indexOf('\\end{tikzpicture}')).toBeLessThan(lines.indexOf('\\end{document}'));
    expect(environmentsBalance(tex)).toBe(true);
    expect(braceBalance(tex)).toBe(0);
  });

  it('flips the y axis and starts at the origin', () => {
    const tex = toTikz(tiny());
    // p: x 100 -> 0 cm, y 300 (lowest on screen) -> 0 cm. q: x 300 -> 4 cm, y 100 -> 4 cm.
    expect(tex).toContain('(p) at (0,0)');
    expect(tex).toContain('(q) at (4,4)');
    expect(tex).toContain('(t) at (2,2)');
  });

  it('applies the scale', () => {
    expect(toTikz(tiny(), { scale: 0.01 })).toContain('(q) at (2,2)');
  });

  it('draws weights and hides them without inscriptions', () => {
    expect(toTikz(tiny())).toMatch(/\(t\) -- node\[[^\]]*\] \{2\} \(q\)/);
    expect(toTikz(tiny(), { inscriptions: false })).not.toContain('{2}');
  });

  it('labels with names, ids or nothing', () => {
    expect(toTikz(tiny())).toContain('label={below:{Wait}}');
    expect(toTikz(tiny(), { labels: 'ids' })).toContain('label={below:{p}}');
    expect(toTikz(tiny(), { labels: 'none' })).not.toContain('label=');
  });

  it('draws tokens as dots, as numbers or not at all', () => {
    const dots = toTikz(tiny());
    expect(dots.match(/\\node\[token\]/g)).toHaveLength(3);
    const count = toTikz(tiny(), { tokens: 'count' });
    expect(count).not.toContain('[token]');
    expect(count).toContain('(p) at (0,0) {3};');
    expect(toTikz(tiny(), { tokens: 'none' })).not.toMatch(/\{3\}|\[token\]/);
  });

  it('switches from dots to a number above five tokens', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const net = tiny();
      net.marking['p'] = Array.from({ length: n }, () => 1);
      expect(toTikz(net).match(/\[token\]/g)).toHaveLength(n);
    }
    const net = tiny();
    net.marking['p'] = Array.from({ length: TIKZ_MAX_DOTS + 1 }, () => 1);
    const tex = toTikz(net);
    expect(tex).not.toContain('[token]');
    expect(tex).toContain(`{${TIKZ_MAX_DOTS + 1}};`);
  });

  it('draws the number for JSON nets', () => {
    const net = example('order-processing');
    const tex = toTikz(net);
    expect(tex).not.toContain('[token]');
    expect(tex).toContain('(incoming)');
    expect(tex).toMatch(/\(incoming\) at \([\d.]+,[\d.]+\) \{4\};/);
  });

  it('takes a marking from the options', () => {
    const net = tiny();
    expect(toTikz(net, { marking: { q: [1] }, tokens: 'count' })).toContain('(q) at (4,4) {1};');
  });

  it('leaves the styles to the document in external mode', () => {
    const tex = toTikz(tiny(), { styles: 'external' });
    expect(tex).not.toContain('\\tikzset');
    expect(tex).toContain('\\node[place');
    expect(tex).toContain('\\node[transition');
    expect(tex).toContain('\\draw[arc]');
    expect(tex).toContain('\\node[token]');
  });

  it('is grayscale unless asked otherwise', () => {
    expect(toTikz(tiny())).not.toMatch(/blue|orange|red|green|yellow/);
    expect(toTikz(tiny(), { grayscale: false })).toMatch(/blue/);
  });

  it('routes arcs over their bend points', () => {
    const net = tiny();
    net.arcs[0]!.points = [{ x: 100, y: 200 }];
    expect(toTikz(net)).toContain('\\draw[arc] (p) -- (0,2) -- (t);');
  });

  it('bends arcs that have an arc in the opposite direction', () => {
    const net = tiny();
    net.arcs.push(
      { id: 'c', source: 'q', target: 't', weight: 1 },
      { id: 'd', source: 't', target: 'p', weight: 1 },
    );
    const tex = toTikz(net);
    expect(tex).toContain('\\draw[arc] (p) to[bend left=20] (t);');
    expect(tex).toContain('\\draw[arc] (t) to[bend left=20] (p);');
  });

  it('shows guards, types and capacities of JSON nets, and hides them on request', () => {
    const net = example('order-processing');
    const shown = toTikz(net);
    expect(shown).toContain('\\texttt{[\\$o.amount > 0]}');
    expect(shown).toContain('\\texttt{Order}');
    const hidden = toTikz(net, { inscriptions: false });
    expect(hidden).not.toContain('texttt');
    const capacity = toTikz(example('producer-consumer'));
    expect(capacity).toContain('$k{=}3$');
  });

  it('gives every node a unique TikZ name', () => {
    const net = createEmptyNet('Names');
    net.places.push(
      { id: 'a b', name: 'one', position: { x: 0, y: 0 } },
      { id: 'a_b', name: 'two', position: { x: 50, y: 0 } },
      { id: 'a.b', name: 'three', position: { x: 100, y: 0 } },
    );
    const names = [...toTikz(net).matchAll(/\\node\[place[^\n]*?\] \(([^)]*)\)/g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('draws an empty net', () => {
    const tex = toTikz(createEmptyNet('Empty'), { standalone: true });
    expect(tex).toContain('\\begin{tikzpicture}');
    expect(braceBalance(tex)).toBe(0);
  });

  it('is deterministic', () => {
    expect(toTikz(example('parcel-center'))).toBe(toTikz(example('parcel-center')));
  });
});

describe('texEscape', () => {
  it.each([
    ['&', '\\&'],
    ['%', '\\%'],
    ['$', '\\$'],
    ['#', '\\#'],
    ['_', '\\_'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['~', '\\textasciitilde{}'],
    ['^', '\\textasciicircum{}'],
    ['\\', '\\textbackslash{}'],
  ])('escapes %s', (input, output) => {
    expect(texEscape(input)).toBe(output);
  });

  it('keeps umlauts and replaces line breaks', () => {
    expect(texEscape('Prüfen\nÄ ß € 日本')).toBe('Prüfen Ä ß € 日本');
  });

  it('escapes every special character of a name, guard and inscription in the output', () => {
    const net = tiny();
    net.name = '50% of #1';
    net.places[0]!.name = 'A & B_c {x} ~ ^ \\ $';
    net.transitions[0]!.guard = '$x % 2 = 0 & {a}';
    net.arcs[0]!.inscription = '#1_\\';
    net.profile = 'json-net';
    const tex = toTikz(net);
    expect(tex).toContain(
      '{A \\& B\\_c \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\$}',
    );
    expect(tex).toContain('\\texttt{[\\$x \\% 2 = 0 \\& \\{a\\}]}');
    expect(tex).toContain('\\texttt{\\#1\\_\\textbackslash{}}');
    expect(braceBalance(tex)).toBe(0);
  });
});

describe('toTikz output is well-formed for every example and random text', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.pn.json'));

  it.each(files)('balances braces and environments in %s', (file) => {
    const net = parseNetText(readFileSync(join(examplesDir, file), 'utf8'));
    for (const options of [{}, { standalone: true }, { styles: 'external' as const }]) {
      const tex = toTikz(net, options);
      expect(braceBalance(tex)).toBe(0);
      expect(environmentsBalance(tex)).toBe(true);
      expect(tex.match(/\\node\[place/g) ?? []).toHaveLength(net.places.length);
      expect(tex.match(/\\node\[transition/g) ?? []).toHaveLength(net.transitions.length);
      expect(tex.match(/\\draw\[arc\]/g) ?? []).toHaveLength(net.arcs.length);
    }
  });

  it('keeps braces balanced whatever the text (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (name, guard) => {
        const net = tiny();
        net.profile = 'json-net';
        net.places[0]!.name = name;
        net.transitions[0]!.guard = guard;
        net.arcs[0]!.inscription = guard;
        const tex = toTikz(net);
        expect(braceBalance(tex)).toBe(0);
        // A comment character in text must always be escaped.
        for (const line of tex.split('\n')) {
          if (!line.trimStart().startsWith('%'))
            expect(line.replace(/\\%/g, '')).not.toContain('%');
        }
      }),
      { numRuns: 300 },
    );
  });
});
