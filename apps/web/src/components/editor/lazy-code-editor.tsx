import { lazy, Suspense } from 'react';
import type { CodeEditorProps } from './code-editor';

const CodeEditor = lazy(() => import('./code-editor'));

/** Placeholder with the final height while the editor chunk loads. */
function Skeleton({ minHeight }: { minHeight?: string }) {
  return (
    <div
      className="rounded-md border border-border-strong bg-surface"
      style={{ minHeight: minHeight ?? '2rem' }}
      aria-hidden="true"
    />
  );
}

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<Skeleton minHeight={props.minHeight} />}>
      <CodeEditor {...props} />
    </Suspense>
  );
}

export type { CodeEditorProps, EditorDiagnostic } from './code-editor';
