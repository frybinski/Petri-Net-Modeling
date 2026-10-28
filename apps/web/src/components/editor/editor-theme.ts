import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** Colours come from CSS variables, so the editor follows the light and dark theme. */
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '12.5px',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
  },
  '&.cm-focused': {
    outline: '2px solid var(--accent)',
    outlineOffset: '1px',
  },
  '.cm-scroller': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    lineHeight: '1.5',
  },
  '.cm-content': { padding: '5px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
    borderRadius: '6px 0 0 6px',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)' },
  '.cm-placeholder': { color: 'var(--text-muted)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    boxShadow: 'var(--shadow)',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text)',
  },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '0.8em' },
  '.cm-completionInfo': { fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-diagnostic': { fontFamily: 'var(--font-sans)', fontSize: '12px', padding: '3px 8px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warn)' },
});

const highlightStyle = HighlightStyle.define([
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: [tags.bool, tags.null, tags.keyword], color: 'var(--syn-keyword)' },
  { tag: tags.variableName, color: 'var(--syn-variable)', fontWeight: '600' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-function)' },
  { tag: tags.propertyName, color: 'var(--syn-property)' },
  { tag: tags.operator, color: 'var(--syn-operator)' },
  { tag: tags.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
  {
    tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace, tags.paren],
    color: 'var(--syn-punctuation)',
  },
]);

export const editorHighlighting = syntaxHighlighting(highlightStyle);
