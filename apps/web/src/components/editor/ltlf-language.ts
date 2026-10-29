import { StreamLanguage, type StreamParser } from '@codemirror/language';

const OPERATORS = new Set(['X', 'Xw', 'F', 'G', 'U', 'W', 'R']);
const CONSTANTS = new Set(['true', 'false']);

/** LTLf: quoted activity names, the temporal operators `X Xw F G U W R`, and the boolean connectives. */
const parser: StreamParser<null> = {
  name: 'ltlf',
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      let escaped = false;
      let ch: string | void;
      while ((ch = stream.next()) !== undefined) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) break;
      }
      return 'string';
    }
    if (stream.match('<->') || stream.match('->') || stream.match(/^(?:&&|\|\||[!&|])/)) {
      return 'operator';
    }
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u)) {
      const word = stream.current();
      if (OPERATORS.has(word)) return 'keyword';
      if (CONSTANTS.has(word)) return 'atom';
      return 'propertyName';
    }
    stream.next();
    return 'punctuation';
  },
  languageData: {
    closeBrackets: { brackets: ['(', '"', "'"] },
  },
};

export const ltlfLanguage = StreamLanguage.define(parser);
