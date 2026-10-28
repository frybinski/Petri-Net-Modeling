import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import CodeEditor from './code-editor';

function viewOf(testId: string): EditorView {
  const content = screen.getByTestId(testId);
  const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement);
  if (!view) throw new Error('editor not found');
  return view;
}

describe('CodeEditor', () => {
  it('shows the value and reports edits', () => {
    const onChange = vi.fn();
    render(
      <CodeEditor
        value="$a + 1"
        language="jsonata"
        ariaLabel="Guard"
        data-testid="ed"
        onChange={onChange}
      />,
    );
    const view = viewOf('ed');
    expect(view.state.doc.toString()).toBe('$a + 1');
    expect(screen.getByRole('textbox', { name: 'Guard' })).toBeInTheDocument();
    act(() => {
      view.dispatch({ changes: { from: 0, to: 2, insert: '$b' } });
    });
    expect(onChange).toHaveBeenLastCalledWith('$b + 1');
  });

  it('follows an external value change such as undo', () => {
    const { rerender } = render(
      <CodeEditor value="one" language="jsonata" ariaLabel="Guard" data-testid="ed" />,
    );
    rerender(<CodeEditor value="two" language="jsonata" ariaLabel="Guard" data-testid="ed" />);
    expect(viewOf('ed').state.doc.toString()).toBe('two');
  });

  it('keeps single-line editors on one line', () => {
    render(
      <CodeEditor value="a" language="jsonata" singleLine ariaLabel="Guard" data-testid="ed" />,
    );
    const view = viewOf('ed');
    act(() => {
      view.dispatch({ changes: { from: 1, insert: '\nb' } });
    });
    expect(view.state.doc.lines).toBe(1);
    expect(view.state.doc.toString()).toBe('a b');
  });

  it('can be made read-only', () => {
    render(<CodeEditor value="a" language="json" readOnly ariaLabel="Schema" data-testid="ed" />);
    expect(viewOf('ed').state.readOnly).toBe(true);
  });
});
