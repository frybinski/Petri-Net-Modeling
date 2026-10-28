import { StreamLanguage, type StreamParser } from '@codemirror/language';

const KEYWORDS = new Set(['and', 'or', 'in', 'function', 'true', 'false', 'null']);
const OPERATORS = /^(?:\.\.|:=|!=|<=|>=|~>|\*\*|[-+*/%=<>&|^?:~@#.])/;

interface State {
  /** Inside a `/* ... *\/` comment. */
  comment: boolean;
}

/** Just enough JSONata to colour it: strings, numbers, `$variables`, `$functions()`, keywords, operators. */
const parser: StreamParser<State> = {
  name: 'jsonata',
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      while (!stream.eol()) {
        if (stream.match('*/')) {
          state.comment = false;
          break;
        }
        stream.next();
      }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('/*')) {
      state.comment = true;
      return 'comment';
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'" || quote === '`') {
      stream.next();
      let escaped = false;
      let ch: string | void;
      while ((ch = stream.next()) !== undefined) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) break;
      }
      return quote === '`' ? 'propertyName' : 'string';
    }
    if (stream.match(/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/)) return 'number';
    if (stream.eat('$')) {
      stream.match(/^[\p{L}\p{N}_]*/u);
      return stream.peek() === '(' ? 'variableName.function' : 'variableName';
    }
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u)) {
      return KEYWORDS.has(stream.current()) ? 'keyword' : 'propertyName';
    }
    if (stream.match(OPERATORS)) return 'operator';
    stream.next();
    return 'punctuation';
  },
  languageData: {
    closeBrackets: { brackets: ['(', '[', '{', '"', "'"] },
    commentTokens: { block: { open: '/*', close: '*/' } },
  },
};

export const jsonataLanguage = StreamLanguage.define(parser);
