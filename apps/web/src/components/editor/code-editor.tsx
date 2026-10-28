import { autocompletion, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers as lineNumbersExtension,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { FUNCTIONS } from '@pnm/expr';
import { useEffect, useRef } from 'react';
import { editorHighlighting, editorTheme } from './editor-theme';
import { jsonataLanguage } from './jsonata-language';

export interface EditorDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface CodeEditorProps {
  value: string;
  /** Called on every change of the text. */
  onChange?: (value: string) => void;
  /** Called when the editor loses focus, or on Ctrl/Cmd+Enter (and Enter in single-line mode). */
  onCommit?: (value: string) => void;
  language: 'json' | 'jsonata';
  /** One logical line: newlines are replaced by spaces and Enter commits. Long text wraps. */
  singleLine?: boolean;
  lineNumbers?: boolean;
  placeholder?: string;
  diagnostics?: readonly EditorDiagnostic[];
  /** Variable names (without `$`) offered by completion in JSONata mode. */
  variables?: readonly string[];
  /** Offer completion (default true). */
  completion?: boolean;
  readOnly?: boolean;
  ariaLabel: string;
  /** CSS min-height of the editing area, for example `4.5rem`. */
  minHeight?: string;
  maxHeight?: string;
  autoFocus?: boolean;
  'data-testid'?: string;
}

function jsonataCompletions(getVariables: () => readonly string[]) {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/\$[\p{L}\p{N}_]*/u);
    if (!match || (match.from === match.to && !context.explicit)) return null;
    return {
      from: match.from,
      validFor: /^\$[\p{L}\p{N}_]*$/u,
      options: [
        ...getVariables().map((name) => ({
          label: `$${name}`,
          type: 'variable',
          detail: 'bound variable',
          boost: 10,
        })),
        ...FUNCTIONS.map((fn) => ({
          label: `$${fn.name}`,
          type: 'function',
          detail: fn.signature.replace(/^\$\w+/, ''),
          info: fn.detail,
          apply: `$${fn.name}()`,
        })),
      ],
    };
  };
}

/** CodeMirror 6 wrapped for React. Load it through `LazyCodeEditor` to keep it out of the main bundle. */
export default function CodeEditor(props: CodeEditorProps) {
  const {
    value,
    language,
    singleLine = false,
    lineNumbers = false,
    placeholder,
    readOnly = false,
    ariaLabel,
    minHeight,
    maxHeight,
    autoFocus,
    diagnostics,
    'data-testid': testId,
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest props for the long-lived editor callbacks.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const external = useRef(value);
  const editable = useRef(new Compartment());

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // Destroying a focused editor blurs it: that must not count as leaving the field.
    let disposed = false;
    const commit = (): void => {
      if (disposed) return;
      latest.current.onCommit?.(view.current?.state.doc.toString() ?? '');
    };
    const extensions: Extension[] = [
      editorTheme,
      editorHighlighting,
      history(),
      bracketMatching(),
      indentOnInput(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': ariaLabel,
        ...(testId ? { 'data-testid': testId } : {}),
      }),
      editable.current.of([EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]),
      language === 'json' ? json() : jsonataLanguage,
      ...(props.completion === false
        ? []
        : [
            autocompletion({
              activateOnTyping: true,
              override:
                language === 'jsonata'
                  ? [jsonataCompletions(() => latest.current.variables ?? [])]
                  : [],
            }),
          ]),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            commit();
            return true;
          },
        },
        ...(singleLine
          ? [
              {
                key: 'Enter',
                run: () => {
                  commit();
                  return true;
                },
              },
            ]
          : []),
        {
          key: 'Escape',
          run: (target) => {
            // Revert to the committed text and leave the field.
            const original = external.current;
            if (target.state.doc.toString() !== original) {
              target.dispatch({
                changes: { from: 0, to: target.state.doc.length, insert: original },
              });
            }
            target.contentDOM.blur();
            return true;
          },
        },
        ...completionKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange?.(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        blur: () => {
          commit();
        },
      }),
      EditorView.theme({
        '.cm-content': { minHeight: minHeight ?? 'auto' },
        '.cm-scroller': { maxHeight: maxHeight ?? 'none', overflow: 'auto' },
      }),
    ];
    if (lineNumbers) extensions.push(lineNumbersExtension());
    if (placeholder) extensions.push(placeholderExtension(placeholder));
    if (singleLine) {
      extensions.push(
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && tr.newDoc.lines > 1
            ? [
                tr,
                {
                  changes: {
                    from: 0,
                    to: tr.newDoc.length,
                    insert: tr.newDoc.toString().replace(/\s*\n\s*/g, ' '),
                  },
                  sequential: true,
                },
              ]
            : tr,
        ),
      );
    }
    const instance = new EditorView({
      parent: element,
      state: EditorState.create({ doc: external.current, extensions }),
    });
    view.current = instance;
    if (autoFocus) instance.focus();
    return () => {
      disposed = true;
      instance.destroy();
      view.current = null;
    };
    // The editor is created once; changing props are read through refs and effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external changes (undo, a different element selected).
  useEffect(() => {
    external.current = value;
    const instance = view.current;
    if (instance && instance.state.doc.toString() !== value) {
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const length = instance.state.doc.length;
    instance.dispatch(
      setDiagnostics(
        instance.state,
        (diagnostics ?? []).map((d) => ({
          from: Math.min(Math.max(0, d.from), length),
          to: Math.min(Math.max(d.from, d.to), length),
          message: d.message,
          severity: d.severity,
        })),
      ),
    );
  }, [diagnostics, value]);

  return <div ref={host} className="code-editor min-w-0" />;
}
