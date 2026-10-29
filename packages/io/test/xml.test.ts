import { describe, expect, it } from 'vitest';
import {
  XmlParseError,
  cdata,
  childElements,
  escapeXmlAttribute,
  escapeXmlText,
  firstChild,
  parseXml,
  textContent,
} from '../src/xml';

describe('parseXml', () => {
  it('reads elements, attributes and text', () => {
    const root = parseXml('<a x="1" y=\'two\'><b>hi</b><c/></a>');
    expect(root.name).toBe('a');
    expect(root.attributes).toEqual({ x: '1', y: 'two' });
    expect(childElements(root).map((e) => e.name)).toEqual(['b', 'c']);
    expect(textContent(firstChild(root, 'b')!)).toBe('hi');
  });

  it('skips the declaration, comments, processing instructions and the DOCTYPE', () => {
    const root = parseXml(
      '﻿<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE a [<!ENTITY e "x>y">]>\n<?pi data?><a><!-- inner -->t</a>\n<!-- after -->\n',
    );
    expect(root.name).toBe('a');
    expect(textContent(root)).toBe('t');
  });

  it('decodes the predefined entities and character references', () => {
    const root = parseXml('<a t="&lt;&amp;&quot;&#65;&#x42;">&gt;&apos;&#x1F600;</a>');
    expect(root.attributes['t']).toBe('<&"AB');
    expect(textContent(root)).toBe(">'\u{1F600}");
  });

  it('keeps CDATA literally and joins it with the surrounding text', () => {
    const root = parseXml('<a>x<![CDATA[<b>&amp;]]>y</a>');
    expect(root.children).toEqual(['x<b>&amp;y']);
  });

  it('ignores namespace prefixes and declarations', () => {
    const root = parseXml('<p:pnml xmlns:p="urn:x" xmlns="urn:y" p:id="q"><p:net/></p:pnml>');
    expect(root.name).toBe('pnml');
    expect(root.attributes).toEqual({ id: 'q' });
    expect(childElements(root)[0]?.name).toBe('net');
  });

  it('normalises line ends in text and attributes', () => {
    const root = parseXml('<a v="1\n2\t3">a\r\nb\rc</a>');
    expect(root.attributes['v']).toBe('1 2 3');
    expect(textContent(root)).toBe('a\nb\nc');
  });

  it('keeps a character reference to a carriage return', () => {
    expect(textContent(parseXml('<a>x&#13;y</a>'))).toBe('x\ry');
  });

  it('records the line of a start tag', () => {
    const root = parseXml('<a>\n  <b/>\n\n  <c/>\n</a>');
    expect(childElements(root).map((e) => e.line)).toEqual([2, 4]);
  });

  it('does not expand entities of the DOCTYPE', () => {
    const bomb = '<!DOCTYPE a [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><a>&b;</a>';
    expect(() => parseXml(bomb)).toThrow(XmlParseError);
  });

  it.each([
    ['', 'empty'],
    ['plain text', 'must start with an element'],
    ['<a>', 'not closed'],
    ['<a></b>', 'does not match'],
    ['<a><b></a></b>', 'does not match'],
    ['<a/><b/>', 'after the root'],
    ['<a x=1/>', 'quoted'],
    ['<a x="1" x2></a>', 'needs a value'],
    ['<a x="<"/>', '"<" is not allowed'],
    ['<a>&nope;</a>', 'Unknown entity'],
    ['<a>&#0;</a>', 'not a valid character reference'],
    ['<a>a & b</a>', 'must start a reference'],
    ['<a><!-- open</a>', 'comment is not closed'],
    ['<a><![CDATA[x</a>', 'CDATA'],
    ['<a x="1"y="2"/>', 'separated'],
    ['</a>', 'Unexpected closing tag'],
  ])('rejects %j', (text, message) => {
    expect(() => parseXml(text)).toThrow(XmlParseError);
    if (message) expect(() => parseXml(text)).toThrow(message);
  });

  it('reports the position of an error', () => {
    try {
      parseXml('<a>\n  <b>\n</a>');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XmlParseError);
      expect((error as XmlParseError).line).toBe(3);
    }
  });

  it('refuses very deep nesting without overflowing the stack', () => {
    const deep = `${'<a>'.repeat(5000)}${'</a>'.repeat(5000)}`;
    expect(() => parseXml(deep)).toThrow('nested deeper');
  });

  it('reads a large flat document quickly', () => {
    const body = Array.from({ length: 20000 }, (_, i) => `<p id="p${i}"><n>${i}</n></p>`).join('');
    const started = Date.now();
    const root = parseXml(`<r>${body}</r>`);
    expect(childElements(root)).toHaveLength(20000);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('writing helpers', () => {
  it('escapes text and attributes and drops characters XML cannot hold', () => {
    expect(escapeXmlText('a<b>&"c"\u0001\r')).toBe('a&lt;b&gt;&amp;"c"&#13;');
    expect(escapeXmlAttribute('a"b\n\t<')).toBe('a&quot;b&#10;&#9;&lt;');
  });

  it('splits "]]>" inside CDATA', () => {
    const wrapped = cdata('a]]>b');
    expect(textContent(parseXml(`<a>${wrapped}</a>`))).toBe('a]]>b');
  });
});
