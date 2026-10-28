import type { Id } from '@pnm/core';
import { SPRITES, type DomainDiagnostic, type DomainView } from '@pnm/domain';
import { AlertCircle, AlertTriangle, CheckCircle2, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { en } from '../../i18n/en';
import {
  analyseDomainView,
  applyViewText,
  checkViewText,
  countSeverities,
  fillMissingEntries,
  generateGenericView,
  originCounts,
  removeDomainView,
  updateViewHash,
  updateViewMeta,
  viewToText,
} from '../../lib/domain-view';
import { formatOrigin } from '../../lib/domain-hover';
import { locateJsonPath, splitPath } from '../../lib/json-path';
import { getViewApi } from '../../lib/view-api';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { NumberField, SelectField, TextField } from '../ui/fields';
import { LazyCodeEditor, type EditorDiagnostic } from '../editor/lazy-code-editor';
import { parseJson } from '../../lib/json-text';

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0"
      data-testid={testId}
    >
      <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Where a click on a diagnostic leads: the element in the net, if there is one. */
function jumpTo(diagnostic: DomainDiagnostic): void {
  const id = diagnostic.elementId;
  if (id === undefined) return;
  const state = useEditorStore.getState();
  const exists =
    state.net.places.some((p) => p.id === id) ||
    state.net.transitions.some((t) => t.id === id) ||
    state.net.arcs.some((a) => a.id === id);
  if (!exists) return;
  state.select([id]);
  getViewApi()?.focus([id]);
}

function DiagnosticRow({ diagnostic }: { diagnostic: DomainDiagnostic }) {
  const error = diagnostic.severity === 'error';
  const Icon = error ? AlertCircle : AlertTriangle;
  const clickable = diagnostic.elementId !== undefined;
  const body = (
    <>
      <Icon
        size={14}
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${error ? 'text-danger' : 'text-warn'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={`rounded px-1 font-mono text-[10px] font-semibold ${error ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}
          >
            {diagnostic.rule}
          </span>
          <span className="text-xs break-words">{diagnostic.message}</span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">
          {diagnostic.path}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={() => {
            jumpTo(diagnostic);
          }}
          className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover"
          data-testid="domain-diagnostic"
          data-rule={diagnostic.rule}
        >
          {body}
        </button>
      ) : (
        <div
          className="flex w-full items-start gap-2 px-1.5 py-1"
          data-testid="domain-diagnostic"
          data-rule={diagnostic.rule}
        >
          {body}
        </div>
      )}
    </li>
  );
}

/** Markers for the JSON editor: the diagnostics of the draft at their place in the text. */
function editorMarkers(text: string, diagnostics: readonly DomainDiagnostic[]): EditorDiagnostic[] {
  return diagnostics.flatMap((d) => {
    const range = locateJsonPath(text, splitPath(d.path));
    return range
      ? [
          {
            from: range.from,
            to: range.to,
            message: `${d.rule}: ${d.message}`,
            severity: d.severity,
          },
        ]
      : [];
  });
}

function JsonSection({ locked }: { locked: boolean }) {
  const net = useEditorStore((s) => s.net);
  const stored = useMemo(() => viewToText(net.domainView), [net.domainView]);
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  // Follow changes from elsewhere (undo, an action of the panel, another document).
  if (stored !== seen) {
    setSeen(stored);
    setDraft(stored);
  }
  const parsed = useMemo(() => parseJson(draft), [draft]);
  const checked = useMemo(
    () => (parsed.ok ? checkViewText(net, draft) : null),
    [parsed, net, draft],
  );
  const markers: EditorDiagnostic[] = !parsed.ok
    ? [{ ...parsed.range, message: parsed.message, severity: 'error' }]
    : checked
      ? editorMarkers(draft, checked.diagnostics)
      : [];
  const counts = checked ? countSeverities(checked.diagnostics) : { errors: 0, warnings: 0 };
  const dirty = draft !== stored;
  const canApply = dirty && !locked && checked?.ok === true;

  return (
    <Section title={en.domain.json} testId="domain-json-section">
      <p className="m-0 text-[11px] text-muted">{en.domain.jsonHint}</p>
      <LazyCodeEditor
        value={draft}
        onChange={setDraft}
        language="json"
        lineNumbers
        completion={false}
        readOnly={locked}
        minHeight="10rem"
        maxHeight="24rem"
        ariaLabel={en.domain.json}
        diagnostics={markers}
        data-testid="domain-json"
      />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!canApply}
          onClick={() => {
            applyViewText(draft);
          }}
          data-testid="domain-apply"
        >
          {en.domain.apply}
        </Button>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setDraft(stored);
          }}
          data-testid="domain-revert"
        >
          {en.domain.revert}
        </Button>
        <span
          className={`ml-auto text-[11px] ${!parsed.ok || counts.errors > 0 ? 'text-danger' : counts.warnings > 0 ? 'text-warn' : 'text-muted'}`}
          role="status"
          data-testid="domain-draft-status"
        >
          {!parsed.ok
            ? en.domain.draftNotJson
            : dirty
              ? en.domain.draftProblems(counts.errors, counts.warnings)
              : ''}
        </span>
      </div>
    </Section>
  );
}

function EntrySection({ view }: { view: DomainView }) {
  const net = useEditorStore((s) => s.net);
  const selection = useEditorStore((s) => s.selection);
  const id: Id | undefined = selection.length === 1 ? selection[0] : undefined;
  let body: ReactNode = <p className="m-0 text-xs text-muted">{en.domain.entryNone}</p>;
  if (id !== undefined) {
    const arc = net.arcs.find((a) => a.id === id);
    const key = arc ? `${arc.source}>${arc.target}` : undefined;
    const isPlace = net.places.some((p) => p.id === id);
    const isTransition = net.transitions.some((t) => t.id === id);
    const entry = isPlace
      ? view.places[id]
      : isTransition
        ? view.transitions[id]
        : key
          ? view.arcs?.[key]
          : undefined;
    const provenanceKey = isPlace
      ? `places.${id}`
      : isTransition
        ? `transitions.${id}`
        : key
          ? `arcs.${key}`
          : undefined;
    const origin = provenanceKey ? view.provenance[provenanceKey] : undefined;
    if (isPlace || isTransition || arc) {
      body = entry ? (
        <>
          <pre
            className="m-0 max-h-48 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-4"
            data-testid="domain-entry"
          >
            {JSON.stringify(entry, null, 2)}
          </pre>
          {origin ? (
            <p className="m-0 text-[11px] text-muted" data-testid="domain-entry-origin">
              {en.domain.origin1}: {formatOrigin(origin)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-xs text-muted">{en.domain.entryMissing}</p>
      );
    }
  }
  return (
    <Section title={en.domain.entry} testId="domain-entry-section">
      {body}
    </Section>
  );
}

/** The panel of the domain view: appearance, status, diagnostics, actions and the JSON text. */
export function DomainPanel() {
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const analysis = useMemo(() => analyseDomainView(net), [net]);
  const locked = mode === 'simulate';
  const view = analysis.validation?.view ?? null;
  const diagnostics = analysis.validation?.diagnostics ?? [];
  const { errors, warnings } = countSeverities(diagnostics);
  const stale = diagnostics.some((d) => d.rule === 'V7');
  const canUpdateHash = stale && errors === 0 && !locked;
  const canFill = view !== null && !locked;
  const origins = view ? originCounts(view) : null;

  return (
    <aside
      aria-label={en.domain.panelTitle}
      className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-surface"
      data-testid="domain-panel"
    >
      <Section title={en.domain.status}>
        {!analysis.present ? (
          <p className="m-0 text-xs text-muted">{en.domain.emptyBody}</p>
        ) : (
          <>
            <div
              className="flex items-center gap-1.5 text-sm font-medium"
              role="status"
              data-testid="domain-status"
            >
              {errors > 0 ? (
                <AlertCircle size={15} aria-hidden="true" className="text-danger" />
              ) : warnings > 0 ? (
                <AlertTriangle size={15} aria-hidden="true" className="text-warn" />
              ) : (
                <CheckCircle2 size={15} aria-hidden="true" className="text-ok" />
              )}
              <span className={errors > 0 ? 'text-danger' : warnings > 0 ? 'text-warn' : ''}>
                {errors + warnings === 0
                  ? en.domain.noProblems
                  : en.status.problems(errors, warnings)}
              </span>
            </div>
            {origins ? (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">{en.domain.origin}</dt>
                <dd className="m-0 flex flex-wrap gap-x-2.5" data-testid="domain-origins">
                  <span className="whitespace-nowrap" data-testid="origin-generic">
                    {origins.generic} {en.domain.originGeneric}
                  </span>
                  <span className="whitespace-nowrap" data-testid="origin-user">
                    {origins.user} {en.domain.originUser}
                  </span>
                  <span className="whitespace-nowrap" data-testid="origin-llm">
                    {origins.llm} {en.domain.originLlm}
                  </span>
                </dd>
                <dt className="text-muted">{en.domain.hash}</dt>
                <dd
                  className={`m-0 ${stale ? 'text-warn' : ''}`}
                  data-testid="domain-hash-status"
                  data-stale={stale}
                >
                  {stale ? en.domain.hashStale : en.domain.hashOk}
                </dd>
              </dl>
            ) : null}
          </>
        )}
        {diagnostics.length > 0 ? (
          <ul
            className="m-0 -mx-1.5 flex max-h-56 list-none flex-col gap-0.5 overflow-y-auto p-0"
            aria-label={en.domain.problems}
            data-testid="domain-diagnostics"
          >
            {diagnostics.map((d, i) => (
              <DiagnosticRow key={`${d.rule}:${d.path}:${i}`} diagnostic={d} />
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title={en.domain.actions}>
        {locked ? <p className="m-0 text-[11px] text-muted">{en.domain.editLocked}</p> : null}
        <div className="flex flex-col items-stretch gap-2">
          <Button
            icon={<Sparkles size={14} aria-hidden="true" />}
            onClick={generateGenericView}
            disabled={locked}
            data-testid="domain-generate-action"
          >
            {en.domain.generate}
          </Button>
          <Button
            onClick={fillMissingEntries}
            disabled={!canFill}
            title={en.domain.fillTip}
            data-testid="domain-fill"
          >
            {en.domain.fill}
          </Button>
          <Button
            onClick={updateViewHash}
            disabled={!canUpdateHash}
            title={en.domain.updateHashTip}
            data-testid="domain-update-hash"
          >
            {en.domain.updateHash}
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} aria-hidden="true" />}
            onClick={removeDomainView}
            disabled={!analysis.present || locked}
            data-testid="domain-remove"
          >
            {en.domain.remove}
          </Button>
        </div>
      </Section>

      {view ? (
        <Section title={en.domain.meta}>
          <TextField
            label={en.domain.theme}
            value={view.meta.theme}
            disabled={locked}
            onCommit={(theme) => {
              updateViewMeta((meta) => ({ ...meta, theme }));
            }}
          />
          <TextField
            label={en.domain.viewName}
            value={view.meta.viewName}
            disabled={locked}
            onCommit={(viewName) => {
              updateViewMeta((meta) => ({ ...meta, viewName }));
            }}
          />
          <TextField
            label={en.domain.entitySingular}
            value={view.meta.entity.singular}
            disabled={locked}
            onCommit={(singular) => {
              updateViewMeta((meta) => ({ ...meta, entity: { ...meta.entity, singular } }));
            }}
          />
          <TextField
            label={en.domain.entityPlural}
            value={view.meta.entity.plural}
            disabled={locked}
            onCommit={(plural) => {
              updateViewMeta((meta) => ({ ...meta, entity: { ...meta.entity, plural } }));
            }}
          />
          <SelectField
            label={en.domain.sprite}
            value={view.meta.entity.sprite}
            disabled={locked}
            options={SPRITES.map((sprite) => ({
              value: sprite,
              label: en.domain.sprites[sprite] ?? sprite,
            }))}
            onChange={(value) => {
              const sprite = SPRITES.find((s) => s === value);
              if (sprite)
                updateViewMeta((meta) => ({ ...meta, entity: { ...meta.entity, sprite } }));
            }}
            data-testid="domain-sprite"
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={en.domain.canvasWidth}
              value={view.meta.canvas.width}
              min={100}
              max={10000}
              disabled={locked}
              onCommit={(width) => {
                if (width !== undefined) {
                  updateViewMeta((meta) => ({ ...meta, canvas: { ...meta.canvas, width } }));
                }
              }}
            />
            <NumberField
              label={en.domain.canvasHeight}
              value={view.meta.canvas.height}
              min={100}
              max={10000}
              disabled={locked}
              onCommit={(height) => {
                if (height !== undefined) {
                  updateViewMeta((meta) => ({ ...meta, canvas: { ...meta.canvas, height } }));
                }
              }}
            />
          </div>
        </Section>
      ) : null}

      {view ? <EntrySection view={view} /> : null}
      {analysis.present ? <JsonSection locked={locked} /> : null}
    </aside>
  );
}
