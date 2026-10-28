import { Workflow } from 'lucide-react';
import { en } from '../i18n/en';
import { listExamples } from '../lib/examples';
import { openExampleGuarded } from '../lib/files';
import { useEditorStore } from '../store/editor-store';
import { Button } from './ui/button';

/** Shown on top of an empty canvas. */
export function EmptyHint() {
  const empty = useEditorStore(
    (s) => s.net.places.length + s.net.transitions.length + (s.net.annotations?.length ?? 0) === 0,
  );
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div
        className="pointer-events-none max-w-sm rounded-xl border border-border bg-surface/95 p-5 text-center shadow-panel backdrop-blur"
        data-testid="empty-hint"
      >
        <h2 className="m-0 text-base font-semibold">{en.canvas.emptyTitle}</h2>
        <p className="mt-1.5 mb-3 text-sm text-muted">{en.canvas.emptyBody}</p>
        <div
          className="pointer-events-auto flex flex-wrap justify-center gap-2"
          aria-label={en.empty.examples}
        >
          {listExamples().map((example) => (
            <Button
              key={example.id}
              size="sm"
              icon={<Workflow size={13} aria-hidden="true" />}
              onClick={() => {
                openExampleGuarded(example.net);
              }}
            >
              {example.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
