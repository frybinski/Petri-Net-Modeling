/**
 * A small XML reader for the subset that PNML files use: elements, attributes, text, CDATA,
 * comments, processing instructions and the five predefined entities plus character references.
 * Namespace prefixes are ignored (`pnml:place` reads as `place`). A DOCTYPE is skipped without
 * being interpreted, so no entity can expand to more text than it occupies.
 *
 * The same code runs in the browser and in Node, so a file reads the same everywhere.
 */

export interface XmlElement {
  /** Local name, the namespace prefix removed. */
  name: string;
  /** Attributes by local name. Namespace declarations (`xmlns`, `xmlns:x`) are left out. */
  attributes: Record<string, string>;
  /** Child elements and text, in document order. Comments are not kept. */
  children: XmlNode[];
  /** 1-based position of the start tag, for messages. */
  line: number;
}

export type XmlNode = XmlElement | string;

/** Raised for input that is not well-formed XML. */
export class XmlParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'XmlParseError';
    this.line = line;
    this.column = column;
  }
}

/** Deepest nesting that is accepted. Real PNML is a handful of levels deep. */
const MAX_DEPTH = 256;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function isNameStart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x3a ||
    code >= 0xc0
  );
}

function isNameChar(code: number): boolean {
  return isNameStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Parses a document and returns its root element.
 * Throws `XmlParseError` if the text is not well-formed.
 */
export function parseXml(source: string): XmlElement {
  // A byte order mark in front of the text is not part of the document.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const length = text.length;
  let pos = 0;

  const fail = (message: string, at = pos): never => {
    let line = 1;
    let column = 1;
    for (let i = 0; i < Math.min(at, length); i += 1) {
      if (text.charCodeAt(i) === 0x0a) {
        line += 1;
        column = 1;
      } else column += 1;
    }
    throw new XmlParseError(message, line, column);
  };

  // Start tags are met in increasing order, so counting resumes where it stopped.
  let countedTo = 0;
  let countedLine = 1;
  const lineAt = (at: number): number => {
    for (; countedTo < at; countedTo += 1) {
      if (text.charCodeAt(countedTo) === 0x0a) countedLine += 1;
    }
    return countedLine;
  };

  const skipSpace = (): void => {
    while (pos < length && isSpace(text.charCodeAt(pos))) pos += 1;
  };

  const readName = (): string => {
    const start = pos;
    if (pos >= length || !isNameStart(text.charCodeAt(pos))) fail('A name was expected');
    pos += 1;
    while (pos < length && isNameChar(text.charCodeAt(pos))) pos += 1;
    return text.slice(start, pos);
  };

  /** Replaces entity and character references in `raw`, which starts at offset `at`. */
  const decode = (raw: string, at: number): string => {
    if (!raw.includes('&')) return raw;
    let out = '';
    let i = 0;
    while (i < raw.length) {
      const amp = raw.indexOf('&', i);
      if (amp < 0) {
        out += raw.slice(i);
        break;
      }
      out += raw.slice(i, amp);
      const semi = raw.indexOf(';', amp);
      if (semi < 0 || semi - amp > 12)
        fail('An "&" must start a reference such as &amp;', at + amp);
      const body = raw.slice(amp + 1, semi);
      if (body.startsWith('#')) {
        const hex = body.startsWith('#x') || body.startsWith('#X');
        const digits = body.slice(hex ? 2 : 1);
        const valid = hex ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);
        const code = valid ? Number.parseInt(digits, hex ? 16 : 10) : Number.NaN;
        if (
          !Number.isInteger(code) ||
          code < 1 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
        ) {
          fail(`"&${body};" is not a valid character reference`, at + amp);
        }
        out += String.fromCodePoint(code);
      } else {
        const replacement = NAMED_ENTITIES[body];
        if (replacement === undefined) fail(`Unknown entity "&${body};"`, at + amp);
        out += replacement;
      }
      i = semi + 1;
    }
    return out;
  };

  const readAttributeValue = (): string => {
    const quote = text.charAt(pos);
    if (quote !== '"' && quote !== "'") fail('An attribute value must be quoted');
    const start = pos + 1;
    const end = text.indexOf(quote, start);
    if (end < 0) fail('The attribute value is not closed');
    const raw = text.slice(start, end);
    if (raw.includes('<'))
      fail('"<" is not allowed in an attribute value', start + raw.indexOf('<'));
    pos = end + 1;
    // Line breaks and tabs in attribute values count as spaces.
    return decode(raw.replace(/\r\n|[\r\n\t]/g, ' '), start);
  };

  /** Skips `<!DOCTYPE ...>` including an internal subset in brackets. */
  const skipDoctype = (): void => {
    let depth = 0;
    let quote = '';
    while (pos < length) {
      const char = text.charAt(pos);
      if (quote !== '') {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '[') depth += 1;
      else if (char === ']') depth -= 1;
      else if (char === '>' && depth <= 0) {
        pos += 1;
        return;
      }
      pos += 1;
    }
    fail('The DOCTYPE is not closed');
  };

  /** Skips whitespace, comments, processing instructions and a DOCTYPE outside the root. */
  const skipMisc = (): void => {
    for (;;) {
      skipSpace();
      if (text.startsWith('<?', pos)) {
        const end = text.indexOf('?>', pos + 2);
        if (end < 0) fail('The processing instruction is not closed');
        pos = end + 2;
      } else if (text.startsWith('<!--', pos)) {
        const end = text.indexOf('-->', pos + 4);
        if (end < 0) fail('The comment is not closed');
        pos = end + 3;
      } else if (text.startsWith('<!DOCTYPE', pos)) {
        pos += '<!DOCTYPE'.length;
        skipDoctype();
      } else return;
    }
  };

  const pushText = (parent: XmlElement, value: string): void => {
    if (value === '') return;
    const last = parent.children[parent.children.length - 1];
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + value;
    else parent.children.push(value);
  };

  skipMisc();
  if (pos >= length) fail('The document is empty');
  if (text.charAt(pos) !== '<') fail('The document must start with an element');

  const stack: Array<{ element: XmlElement; rawName: string }> = [];
  let root: XmlElement | undefined;

  for (;;) {
    // Between elements: text, comments, CDATA, processing instructions or a tag.
    const current = stack[stack.length - 1];
    if (current === undefined && root !== undefined) {
      skipMisc();
      if (pos < length) fail('Content after the root element');
      return root;
    }
    if (pos >= length) {
      fail(`The element <${current?.rawName ?? ''}> is not closed`);
    }

    if (text.charAt(pos) !== '<') {
      const end = text.indexOf('<', pos);
      const stop = end < 0 ? length : end;
      const raw = text.slice(pos, stop).replace(/\r\n?/g, '\n');
      if (current) pushText(current.element, decode(raw, pos));
      pos = stop;
      continue;
    }

    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end < 0) fail('The comment is not closed');
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', pos)) {
      const end = text.indexOf(']]>', pos + 9);
      if (end < 0) fail('The CDATA section is not closed');
      if (current) pushText(current.element, text.slice(pos + 9, end).replace(/\r\n?/g, '\n'));
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2);
      if (end < 0) fail('The processing instruction is not closed');
      pos = end + 2;
      continue;
    }
    if (text.startsWith('<!', pos)) fail('Unexpected markup declaration');

    if (text.startsWith('</', pos)) {
      pos += 2;
      const rawName = readName();
      skipSpace();
      if (text.charAt(pos) !== '>') fail('A closing tag must end with ">"');
      pos += 1;
      if (!current) fail(`Unexpected closing tag </${rawName}>`);
      if (current?.rawName !== rawName) {
        fail(`The closing tag </${rawName}> does not match <${current?.rawName ?? ''}>`);
      }
      stack.pop();
      continue;
    }

    // A start tag.
    const tagStart = pos;
    pos += 1;
    const rawName = readName();
    const attributes: Record<string, string> = {};
    for (;;) {
      const before = pos;
      skipSpace();
      const char = text.charAt(pos);
      if (char === '>' || char === '/') break;
      if (pos >= length) fail('The start tag is not closed');
      if (pos === before) fail('Attributes must be separated by white space');
      const attributeName = readName();
      skipSpace();
      if (text.charAt(pos) !== '=') fail(`The attribute "${attributeName}" needs a value`);
      pos += 1;
      skipSpace();
      const value = readAttributeValue();
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const name = localName(attributeName);
      // A prefixed attribute never replaces one without prefix.
      if (!(name in attributes) || !attributeName.includes(':')) attributes[name] = value;
    }
    const element: XmlElement = {
      name: localName(rawName),
      attributes,
      children: [],
      line: lineAt(tagStart),
    };
    if (current) current.element.children.push(element);
    else root = element;

    if (text.charAt(pos) === '/') {
      pos += 1;
      if (text.charAt(pos) !== '>') fail('An empty-element tag must end with "/>"');
      pos += 1;
    } else {
      pos += 1;
      if (stack.length >= MAX_DEPTH) fail(`Elements are nested deeper than ${MAX_DEPTH} levels`);
      stack.push({ element, rawName });
    }
  }
}

/** Child elements with the given local name. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (typeof child !== 'string' && (name === undefined || child.name === name)) out.push(child);
  }
  return out;
}

/** The first child element with the given local name. */
export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  for (const child of element.children) {
    if (typeof child !== 'string' && child.name === name) return child;
  }
  return undefined;
}

/** All text below an element, concatenated in document order. */
export function textContent(element: XmlElement): string {
  let out = '';
  for (const child of element.children) {
    out += typeof child === 'string' ? child : textContent(child);
  }
  return out;
}

/** True for the characters that XML 1.0 allows in text. */
export function allowedInXml(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Removes the characters that XML 1.0 cannot represent at all. */
export function stripInvalidXml(value: string): string {
  return [...value].filter((char) => allowedInXml(char.codePointAt(0) ?? 0)).join('');
}

/** Escapes text for use as element content. Characters that XML cannot hold are dropped. */
export function escapeXmlText(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

/** Escapes text for use in a double-quoted attribute value. */
export function escapeXmlAttribute(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

/** Wraps text in CDATA sections; a `]]>` inside is split over two sections. */
export function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}
