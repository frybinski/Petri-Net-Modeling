import {
  addArc,
  addAnnotation,
  addPlace,
  addTransition,
  createEmptyNet,
  setInitialTokens,
  setWeight,
  updateNode,
} from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { escapeXml, netToSvg, wrapNoteText } from './svg-export';

function sampleNet() {
  let net = createEmptyNet('A & B <net>');
  net = addPlace(net, { id: 'p1', name: 'In', position: { x: 0, y: 0 } });
  net = addPlace(net, { id: 'p2', name: 'Out', position: { x: 300, y: 0 } });
  net = addTransition(net, { id: 't1', name: 'go', position: { x: 150, y: 0 } });
  net = addArc(net, 'p1', 't1', { id: 'a1' });
  net = addArc(net, 't1', 'p2', { id: 'a2', weight: 3 });
  net = addArc(net, 't1', 'p1', { id: 'a3' });
  net = setWeight(net, 'a1', 1);
  net = setInitialTokens(net, 'p1', 2);
  net = updateNode(net, 'p2', { capacity: 4 });
  return addAnnotation(net, { id: 'n1', position: { x: 0, y: 120 }, text: 'Note <b>one</b>' });
}

describe('netToSvg', () => {
  const svg = netToSvg(sampleNet());

  it('produces a standalone SVG document with escaped text', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<title>A &amp; B &lt;net&gt;</title>');
    expect(svg).toContain('Note &lt;b&gt;one&lt;/b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('draws every element', () => {
    expect((svg.match(/<circle /g) ?? []).length).toBe(2 + 2); // two places, two token dots
    expect((svg.match(/<rect /g) ?? []).length).toBe(1 + 1 + 1); // background, transition, note
    expect((svg.match(/<polygon /g) ?? []).length).toBe(3); // arrow heads
    expect(svg).toContain('k=4');
    expect(svg).toContain('>3</text>'); // weight label
  });

  it('draws opposite arcs as curves', () => {
    expect((svg.match(/ Q/g) ?? []).length).toBe(2);
  });

  it('uses a number for more than five tokens and the given marking', () => {
    const out = netToSvg(sampleNet(), { marking: { p1: Array.from({ length: 7 }, () => 1) } });
    expect(out).toContain('>7</text>');
  });

  it('supports a dark background and empty nets', () => {
    expect(netToSvg(sampleNet(), { dark: true })).toContain('#111114');
    const empty = netToSvg(createEmptyNet('empty'));
    expect(empty).toContain('viewBox=');
    expect(empty).toContain('<title>empty</title>');
  });
});

describe('text helpers', () => {
  it('escapes XML', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('wraps note text and keeps paragraphs', () => {
    expect(wrapNoteText('short')).toEqual(['short']);
    expect(
      wrapNoteText('one two three four five six seven eight nine ten', 12).length,
    ).toBeGreaterThan(2);
    expect(wrapNoteText('a\nb')).toEqual(['a', 'b']);
    expect(wrapNoteText('')).toEqual(['']);
  });
});
