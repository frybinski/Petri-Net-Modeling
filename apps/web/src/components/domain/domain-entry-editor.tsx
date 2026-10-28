import type { PetriNet } from '@pnm/core';
import { entryOf, kindChoices, type DomainView, type EntryRef, type Point } from '@pnm/domain';
import { Braces, Eye, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { en } from '../../i18n/en';
import {
  addSlotDefault,
  changeBox,
  changeKind,
  changeLabel,
  changePass,
  changePos,
  changeSensor,
  editJson,
  insertPointAfter,
  removePointIndex,
  removeSlotIndex,
  resetToGeneric,
  setPointAt,
  setSlotAt,
  showSelected,
} from '../../lib/domain-edit';
import { Button, IconButton } from '../ui/button';
import { SelectField, TextField, inputClass } from '../ui/fields';

/** A small whole-number field for coordinates: commits on Enter and when it loses the focus. */
function Coord({
  label,
  value,
  onCommit,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled: boolean;
  testId: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(String(value));
  }
  const commit = (): void => {
    const parsed = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    if (Math.round(parsed) !== value) onCommit(Math.round(parsed));
    else setDraft(String(value));
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <label htmlFor={id} className="w-3 shrink-0 text-[10px] text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        data-testid={testId}
        className={`${inputClass} h-7 min-w-0 px-1.5 text-center font-mono text-xs tabular-nums`}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function PointRow({
  title,
  point,
  onChange,
  onRemove,
  disabled,
  testId,
}: {
  title: string;
  point: Point;
  onChange: (to: Point) => void;
  onRemove?: (() => void) | undefined;
  disabled: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={title}>
      <span className="w-14 shrink-0 text-[11px] text-muted">{title}</span>
      <Coord
        label={en.domain.fieldX}
        value={point[0]}
        disabled={disabled}
        testId={`${testId}-x`}
        onCommit={(x) => {
          onChange([x, point[1]]);
        }}
      />
      <Coord
        label={en.domain.fieldY}
        value={point[1]}
        disabled={disabled}
        testId={`${testId}-y`}
        onCommit={(y) => {
          onChange([point[0], y]);
        }}
      />
      {onRemove ? (
        <IconButton
          label={en.domain.removeRow}
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          data-testid={`${testId}-remove`}
        >
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}

const KIND_OPTIONS = (kinds: readonly string[]) =>
  kinds.map((kind) => ({ value: kind, label: en.domain.kinds[kind] ?? kind }));

/**
 * Fields for the entry of the selection: kind, label, sensor, geometry as numbers, slots and the
 * points of paths. Every change goes through the same functions as dragging on the picture.
 */
export function EntryEditor({
  view,
  net,
  entry,
  locked,
}: {
  view: DomainView;
  net: PetriNet;
  entry: EntryRef;
  locked: boolean;
}) {
  const found = entryOf(view, entry);
  if (!found) return null;
  const kind = 'kind' in found ? found.kind : 'arc';
  const hidden = kind === 'hidden';
  const choices =
    entry.section === 'places' || entry.section === 'transitions' ? kindChoices(net, entry) : [];
  const testBase = 'domain-field';

  const box: [number, number, number, number] | null =
    'box' in found ? found.box : 'rect' in found ? found.rect : null;
  const pos: Point | null = 'pos' in found ? found.pos : null;
  const path: Point[] | null = 'path' in found ? found.path : null;
  const slots: Point[] | null = 'slots' in found && found.slots ? found.slots : null;
  const isCard = ['station', 'machine', 'gate', 'area', 'rooms'].includes(kind);
  const hasLabelField = !hidden && ['places', 'transitions'].includes(entry.section);
  const label = 'label' in found ? (found.label ?? '') : 'text' in found ? found.text : '';
  const decorLabel = entry.section === 'decor' && ('label' in found || 'text' in found);

  return (
    <div className="flex flex-col gap-3" data-testid="domain-entry-editor">
      {hidden ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-muted">
            {en.domain.entryHidden('reason' in found ? found.reason : '')}
          </p>
          {entry.section !== 'decor' ? (
            <Button
              size="sm"
              icon={<Eye size={13} aria-hidden="true" />}
              disabled={locked}
              onClick={() => {
                showSelected(entry);
              }}
              data-testid="domain-entry-show"
            >
              {en.domain.entryShow}
            </Button>
          ) : null}
        </div>
      ) : null}
      {choices.length > 1 && !hidden ? (
        <SelectField
          label={en.domain.entryKind}
          value={kind}
          options={KIND_OPTIONS(choices)}
          disabled={locked}
          onChange={(value) => {
            changeKind(entry, value);
          }}
          data-testid="domain-field-kind"
        />
      ) : entry.section === 'decor' ? (
        <p className="m-0 text-xs text-muted">{en.domain.entryDecor(kind)}</p>
      ) : null}
      {hasLabelField || decorLabel ? (
        <TextField
          label={en.domain.entryLabel}
          value={label}
          disabled={locked}
          onCommit={(text) => {
            changeLabel(entry, text);
          }}
          data-testid="domain-field-label"
        />
      ) : null}
      {entry.section === 'transitions' && !hidden ? (
        <TextField
          label={en.domain.entrySensor}
          value={'sensor' in found ? (found.sensor ?? '') : ''}
          disabled={locked}
          onCommit={(text) => {
            changeSensor(entry, text);
          }}
          data-testid="domain-field-sensor"
        />
      ) : null}
      {entry.section === 'transitions' && ['door', 'dock', 'waypoint'].includes(kind) ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={'pass' in found && found.pass === true}
            disabled={locked}
            onChange={(event) => {
              changePass(entry, event.target.checked ? true : undefined);
            }}
            data-testid="domain-field-pass"
          />
          {en.domain.entryPass}
        </label>
      ) : null}
      {box ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-xs font-medium text-muted">{en.domain.entryBox}</legend>
          <div className="flex gap-2">
            {(['fieldX', 'fieldY'] as const).map((key, i) => (
              <Coord
                key={key}
                label={en.domain[key]}
                value={box[i]!}
                disabled={locked}
                testId={`${testBase}-box-${i}`}
                onCommit={(n) => {
                  const next: [number, number, number, number] = [...box];
                  next[i] = n;
                  changeBox(entry, next);
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {(['fieldW', 'fieldH'] as const).map((key, i) => (
              <Coord
                key={key}
                label={en.domain[key].slice(0, 1)}
                value={box[i + 2]!}
                disabled={locked}
                testId={`${testBase}-box-${i + 2}`}
                onCommit={(n) => {
                  const next: [number, number, number, number] = [...box];
                  next[i + 2] = n;
                  changeBox(entry, next);
                }}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      {pos ? (
        <PointRow
          title={en.domain.entryPos}
          point={pos}
          disabled={locked}
          testId={`${testBase}-pos`}
          onChange={(to) => {
            changePos(entry, to);
          }}
        />
      ) : null}
      {path ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-xs font-medium text-muted">{en.domain.entryPath}</legend>
          {path.map((point, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <PointRow
                  title={en.domain.pointN(i + 1)}
                  point={point}
                  disabled={locked}
                  testId={`${testBase}-point-${i}`}
                  onChange={(to) => {
                    setPointAt(entry, i, to);
                  }}
                  onRemove={
                    path.length > 2
                      ? () => {
                          removePointIndex(entry, i);
                        }
                      : undefined
                  }
                />
              </div>
              {i + 1 < path.length ? (
                <IconButton
                  label={en.domain.addPointRow}
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    insertPointAfter(entry, i);
                  }}
                  data-testid={`${testBase}-point-${i}-add`}
                >
                  <Plus size={13} aria-hidden="true" />
                </IconButton>
              ) : (
                <span className="w-7 shrink-0" aria-hidden="true" />
              )}
            </div>
          ))}
        </fieldset>
      ) : null}
      {isCard ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-xs font-medium text-muted">
            {en.domain.entrySlots}
          </legend>
          {(slots ?? []).map((slot, i) => (
            <PointRow
              key={i}
              title={en.domain.slotN(i + 1)}
              point={slot}
              disabled={locked}
              testId={`${testBase}-slot-${i}`}
              onChange={(to) => {
                setSlotAt(entry, i, to);
              }}
              onRemove={() => {
                removeSlotIndex(entry, i);
              }}
            />
          ))}
          <Button
            size="sm"
            icon={<Plus size={13} aria-hidden="true" />}
            disabled={locked}
            onClick={() => {
              addSlotDefault(entry);
            }}
            data-testid={`${testBase}-slot-add`}
          >
            {en.domain.addSlotRow}
          </Button>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {entry.section !== 'decor' ? (
          <Button
            size="sm"
            icon={<RotateCcw size={13} aria-hidden="true" />}
            disabled={locked}
            onClick={() => {
              resetToGeneric(entry);
            }}
            data-testid="domain-entry-reset"
          >
            {en.domain.entryReset}
          </Button>
        ) : null}
        <Button
          size="sm"
          icon={<Braces size={13} aria-hidden="true" />}
          onClick={() => {
            editJson(entry);
          }}
          data-testid="domain-entry-json"
        >
          {en.domain.entryJson}
        </Button>
      </div>
    </div>
  );
}
