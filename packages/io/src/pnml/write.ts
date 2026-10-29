import { isToken, type Id, type PetriNet, type Position } from '@pnm/core';
import { cdata, escapeXmlAttribute, escapeXmlText, stripInvalidXml } from '../xml';
import { PNML_NAMESPACE, PNM_TOOL, PNM_TOOL_VERSION, PTNET_TYPE } from './constants';

export interface PnmlWriteOptions {
  /**
   * Store everything that PNML has no place for (types, inscriptions, guards, timing, roles,
   * simulation settings, the domain view, annotations, token values and the original ids) in
   * `toolspecific` elements. Default true. Other tools ignore them.
   */
  toolspecific?: boolean;
  /** Indent with two spaces and put each element on its own line. Default true. */
  pretty?: boolean;
}

/** A small element tree; `raw` is already escaped inline content. */
interface Out {
  tag: string;
  attrs?: Array<[string, string]>;
  children?: Out[];
  raw?: string;
}

function el(
  tag: string,
  attrs: Array<[string, string]> | undefined,
  children?: Out[],
  raw?: string,
): Out {
  return {
    tag,
    ...(attrs && { attrs }),
    ...(children && { children }),
    ...(raw !== undefined && { raw }),
  };
}

function render(node: Out, pretty: boolean, depth: number, lines: string[]): void {
  const indent = pretty ? '  '.repeat(depth) : '';
  const attrs = (node.attrs ?? [])
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
    .join('');
  if (node.raw !== undefined) {
    lines.push(`${indent}<${node.tag}${attrs}>${node.raw}</${node.tag}>`);
  } else if (!node.children || node.children.length === 0) {
    lines.push(`${indent}<${node.tag}${attrs}/>`);
  } else {
    lines.push(`${indent}<${node.tag}${attrs}>`);
    for (const child of node.children) render(child, pretty, depth + 1, lines);
    lines.push(`${indent}</${node.tag}>`);
  }
}

function num(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function textEl(tag: string, value: string): Out {
  return el(tag, undefined, [el('text', undefined, undefined, escapeXmlText(value))]);
}

function position(p: Position): Out {
  return el('position', [
    ['x', num(p.x)],
    ['y', num(p.y)],
  ]);
}

/** Replaces the characters that XML cannot hold by JSON escapes, so the text stays valid JSON. */
function jsonSafeForXml(json: string): string {
  return json.replace(/[￾￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

function toolspecificEl(payload: Record<string, unknown>): Out | undefined {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return undefined;
  return el(
    'toolspecific',
    [
      ['tool', PNM_TOOL],
      ['version', PNM_TOOL_VERSION],
    ],
    undefined,
    cdata(jsonSafeForXml(JSON.stringify(clean))),
  );
}

/** An XML `ID` (an NCName) derived from an element id, unique among `used`. */
function xmlIdFor(id: string, used: Set<string>): string {
  let out = 'n_';
  for (const char of id) {
    const code = char.codePointAt(0) ?? 0;
    const plain =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x2d ||
      code === 0x2e ||
      code === 0x5f;
    out += plain ? char : `_x${code.toString(16)}_`;
  }
  let candidate = out;
  for (let i = 2; used.has(candidate); i += 1) candidate = `${out}_${i}`;
  used.add(candidate);
  return candidate;
}

/** True if the name does not survive being written as element text and read back. */
function nameNeedsOverride(name: string): boolean {
  return stripInvalidXml(name) !== name || name !== name.trim() || name.includes('\r');
}

/**
 * Writes a net as PNML 2009 (`ptnet`, ISO/IEC 15909-2): places with initial marking, transitions,
 * arcs with weights, positions and bend points. With `toolspecific` (the default) the rest of the
 * model travels in `toolspecific tool="pnm"` elements as JSON in CDATA, which `fromPnml` reads
 * back; other tools skip them. The output is deterministic.
 */
export function toPnml(net: PetriNet, options: PnmlWriteOptions = {}): string {
  const extended = options.toolspecific ?? true;
  const pretty = options.pretty ?? true;

  const used = new Set<string>(['net1', 'page1']);
  const nodeXmlId = new Map<Id, string>();
  const placeXml = net.places.map((place) => {
    const xml = xmlIdFor(place.id, used);
    if (!nodeXmlId.has(place.id)) nodeXmlId.set(place.id, xml);
    return xml;
  });
  const transitionXml = net.transitions.map((transition) => {
    const xml = xmlIdFor(transition.id, used);
    if (!nodeXmlId.has(transition.id)) nodeXmlId.set(transition.id, xml);
    return xml;
  });
  const arcXml = net.arcs.map((arc) => xmlIdFor(arc.id, used));
  // Arcs that point at a node that does not exist keep a distinct, valid reference.
  const dangling = (id: Id): string => {
    const known = nodeXmlId.get(id);
    if (known !== undefined) return known;
    const xml = xmlIdFor(id, used);
    nodeXmlId.set(id, xml);
    return xml;
  };

  const page: Out[] = [];

  net.places.forEach((place, index) => {
    const children: Out[] = [textEl('name', place.name)];
    children.push(el('graphics', undefined, [position(place.position)]));
    const tokens = net.marking[place.id] ?? [];
    if (tokens.length > 0) {
      children.push(
        el('initialMarking', undefined, [el('text', undefined, undefined, String(tokens.length))]),
      );
    }
    if (extended) {
      const keepValues =
        tokens.length > 0 &&
        tokens.every(isToken) &&
        (net.profile === 'json-net' || tokens.some((token) => token !== 1));
      const payload = toolspecificEl({
        id: place.id,
        name: nameNeedsOverride(place.name) ? place.name : undefined,
        type: place.type,
        capacity: place.capacity,
        role: place.role,
        tokens: keepValues ? tokens : undefined,
      });
      if (payload) children.push(payload);
    }
    page.push(el('place', [['id', placeXml[index] ?? '']], children));
  });

  net.transitions.forEach((transition, index) => {
    const children: Out[] = [textEl('name', transition.name)];
    children.push(el('graphics', undefined, [position(transition.position)]));
    if (extended) {
      const payload = toolspecificEl({
        id: transition.id,
        name: nameNeedsOverride(transition.name) ? transition.name : undefined,
        guard: transition.guard,
        timing: transition.timing,
        priority: transition.priority,
        rate: transition.rate,
      });
      if (payload) children.push(payload);
    }
    page.push(el('transition', [['id', transitionXml[index] ?? '']], children));
  });

  net.arcs.forEach((arc, index) => {
    const children: Out[] = [];
    if (arc.weight !== 1) {
      children.push(
        el('inscription', undefined, [el('text', undefined, undefined, num(arc.weight))]),
      );
    }
    if (arc.points && arc.points.length > 0) {
      children.push(el('graphics', undefined, arc.points.map(position)));
    }
    if (extended) {
      const payload = toolspecificEl({ id: arc.id, inscription: arc.inscription });
      if (payload) children.push(payload);
    }
    page.push(
      el(
        'arc',
        [
          ['id', arcXml[index] ?? ''],
          ['source', dangling(arc.source)],
          ['target', dangling(arc.target)],
        ],
        children.length > 0 ? children : undefined,
      ),
    );
  });

  const netChildren: Out[] = [textEl('name', net.name), el('page', [['id', 'page1']], page)];
  if (extended) {
    const placeIds = new Set(net.places.map((p) => p.id));
    const stray: Record<string, unknown> = {};
    for (const [id, tokens] of Object.entries(net.marking)) {
      if (!placeIds.has(id) && tokens.length > 0) stray[id] = tokens;
    }
    const payload = toolspecificEl({
      version: net.version,
      profile: net.profile,
      name: nameNeedsOverride(net.name) ? net.name : undefined,
      types: Object.keys(net.types).length > 0 ? net.types : undefined,
      simulation: net.simulation,
      annotations: net.annotations && net.annotations.length > 0 ? net.annotations : undefined,
      domainView: net.domainView,
      domainViewGeneration: net.domainViewGeneration,
      properties: net.properties,
      strayMarking: Object.keys(stray).length > 0 ? stray : undefined,
    });
    if (payload) netChildren.push(payload);
  }

  const root = el(
    'pnml',
    [['xmlns', PNML_NAMESPACE]],
    [
      el(
        'net',
        [
          ['id', 'net1'],
          ['type', PTNET_TYPE],
        ],
        netChildren,
      ),
    ],
  );
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  render(root, pretty, 0, lines);
  return `${lines.join(pretty ? '\n' : '')}\n`;
}
