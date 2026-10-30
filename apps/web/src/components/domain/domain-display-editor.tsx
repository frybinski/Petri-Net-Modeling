import { placeRoles, type PetriNet } from '@pnm/core';
import {
  SPRITES,
  TINTS,
  allowedIcons,
  entryOf,
  roleHoldsCases,
  suggestDisplay,
  validateDomainView,
  type Appearance,
  type CounterDisplay,
  type DomainDiagnostic,
  type DomainView,
  type EntryRef,
  type Tint,
} from '@pnm/domain';
import { useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { changeAppearance, changeDisplay } from '../../lib/domain-edit';
import { Checkbox } from '../ui/checkbox';
import { NumberField } from '../ui/fields';
import { Segmented } from '../ui/segmented';
import {
  iconOption,
  spriteOption,
  tintOption,
  type PictureOption,
} from '../../lib/domain-picture-options';
import { PicturePicker } from './domain-picture-picker';

type Field = 'style' | 'max' | 'low' | 'per' | 'icon';

/** The field of the display that a finding (by its path) is about. */
function fieldOf(path: string, base: string): Field {
  const rest = path.slice(base.length + 1);
  if (rest.startsWith('max')) return 'max';
  if (rest.startsWith('low')) return 'low';
  if (rest.startsWith('per')) return 'per';
  if (rest.startsWith('icon')) return 'icon';
  return 'style';
}

/** A display with nothing to show beside the number is no display at all. */
function nothingToShow(display: CounterDisplay): boolean {
  return (
    display.style === 'number' &&
    display.history !== true &&
    display.icon === undefined &&
    display.unit === undefined
  );
}

/**
 * The fields of the amount of a counter: how it is shown (number, fill level, pictogram), the
 * limits that belong to that, the symbol and the curve. Every change is one undo step, and what
 * the rules V10 and V11 find wrong stands at the field it is about.
 */
export function DisplayEditor({
  net,
  view,
  entry,
  locked,
}: {
  net: PetriNet;
  view: DomainView;
  entry: EntryRef;
  locked: boolean;
}) {
  const found = entryOf(view, entry);
  const [typed, setTyped] = useState<{ key: string; errors: DomainDiagnostic[] }>({
    key: '',
    errors: [],
  });
  const base = `places.${entry.key}.display`;
  // What is wrong with the display as it is stored, and with the last change that was refused.
  const stored = useMemo(
    () =>
      validateDomainView(net, view).diagnostics.filter(
        (d) => d.severity === 'error' && (d.path === base || d.path.startsWith(`${base}.`)),
      ),
    [net, view, base],
  );
  if (!found || !('kind' in found)) return null;
  if (found.kind !== 'pool' && found.kind !== 'source' && found.kind !== 'sink') return null;
  const role = placeRoles(net).get(entry.key) ?? 'case';
  const display = found.display;
  const style = display?.style ?? 'number';
  const refused = typed.key === JSON.stringify(display ?? null) ? typed.errors : [];
  const errors: Partial<Record<Field, string>> = {};
  for (const d of [...stored, ...refused]) errors[fieldOf(d.path, base)] ??= d.message;

  const apply = (next: CounterDisplay | undefined): void => {
    const cleaned = next !== undefined && nothingToShow(next) ? undefined : next;
    setTyped({ key: JSON.stringify(display ?? null), errors: changeDisplay(entry, cleaned) });
  };
  const styleOptions = (['number', 'fill', 'pictogram'] as const).map((value) => ({
    value,
    label: en.domain.displayStyles[value] ?? value,
  }));
  const icons: PictureOption[] = [
    {
      ...iconOption('dot', en.domain.displayNoIcon),
      value: '',
      draw: (ctx, size, palette) => {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = palette.inkMuted;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    },
    ...allowedIcons(role).map((icon) => iconOption(icon, en.domain.displayIcons[icon] ?? icon)),
  ];

  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" data-testid="domain-display">
      <legend className="mb-1 p-0 text-xs font-medium text-muted">{en.domain.displayTitle}</legend>
      <Segmented
        label={en.domain.displayStyle}
        value={style}
        options={styleOptions}
        disabled={locked}
        hint={en.domain.displayStyleHint}
        onChange={(value) => {
          if (value === style) return;
          apply(
            value === 'number' && display === undefined
              ? undefined
              : suggestDisplay(net, entry.key, value, display),
          );
        }}
        data-testid="domain-field-display-style"
      />
      {errors.style ? (
        <p role="alert" className="m-0 text-[11px] text-danger" data-field-error>
          {errors.style}
        </p>
      ) : null}
      {display?.style === 'fill' ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={en.domain.displayMax}
            value={display.max}
            min={0.01}
            decimals={2}
            disabled={locked}
            error={errors.max}
            onCommit={(max) => {
              if (max !== undefined) apply({ ...display, max });
            }}
            data-testid="domain-field-display-max"
          />
          <NumberField
            label={en.domain.displayLow}
            value={display.low}
            min={0}
            decimals={2}
            allowEmpty
            disabled={locked}
            error={errors.low}
            onCommit={(low) => {
              const { low: _old, ...rest } = display;
              apply(low === undefined ? rest : { ...rest, low });
            }}
            data-testid="domain-field-display-low"
          />
        </div>
      ) : null}
      {display?.style === 'pictogram' ? (
        <NumberField
          label={en.domain.displayPer}
          value={display.per}
          min={0.01}
          decimals={2}
          disabled={locked}
          error={errors.per}
          onCommit={(per) => {
            if (per !== undefined) apply({ ...display, per });
          }}
          data-testid="domain-field-display-per"
        />
      ) : null}
      <PicturePicker
        label={en.domain.displayIcon}
        value={display?.icon ?? ''}
        options={icons}
        disabled={locked}
        error={errors.icon}
        onChange={(value) => {
          const icon = allowedIcons(role).find((i) => i === value);
          const next: CounterDisplay = display ?? { style: 'number' };
          const { icon: _old, ...rest } = next;
          apply(
            icon === undefined ? (rest as CounterDisplay) : ({ ...rest, icon } as CounterDisplay),
          );
        }}
        data-testid="domain-field-display-icon"
      />
      <Checkbox
        label={en.domain.displayHistory}
        hint={en.domain.displayHistoryHint}
        checked={display?.history === true}
        disabled={locked}
        onChange={(history) => {
          const next: CounterDisplay = display ?? { style: 'number' };
          const { history: _old, ...rest } = next;
          apply((history ? { ...rest, history: true } : rest) as CounterDisplay);
        }}
        data-testid="domain-field-display-history"
      />
    </fieldset>
  );
}

/**
 * The look of the cases on a place: the picture and a color from the palette. "Like the entity of
 * the view" takes the field away again.
 */
export function AppearanceEditor({
  net,
  view,
  entry,
  locked,
}: {
  net: PetriNet;
  view: DomainView;
  entry: EntryRef;
  locked: boolean;
}) {
  const found = entryOf(view, entry);
  const [typed, setTyped] = useState<{ key: string; errors: DomainDiagnostic[] }>({
    key: '',
    errors: [],
  });
  const base = `places.${entry.key}.appearance`;
  const stored = useMemo(
    () =>
      validateDomainView(net, view).diagnostics.filter(
        (d) => d.severity === 'error' && (d.path === base || d.path.startsWith(`${base}.`)),
      ),
    [net, view, base],
  );
  if (!found || !('kind' in found)) return null;
  const holdsPath = found.kind === 'queue' || found.kind === 'conveyor' || found.kind === 'buffer';
  if (!holdsPath && found.kind !== 'source' && found.kind !== 'sink') return null;
  const role = placeRoles(net).get(entry.key) ?? 'case';
  if (!roleHoldsCases(role)) return null;
  const appearance: Appearance | undefined = found.appearance;
  const refused = typed.key === JSON.stringify(appearance ?? null) ? typed.errors : [];
  const error = [...stored, ...refused][0]?.message;

  const apply = (next: Appearance | undefined): void => {
    setTyped({ key: JSON.stringify(appearance ?? null), errors: changeAppearance(entry, next) });
  };
  const entity = view.meta.entity.sprite;
  const sprites: PictureOption[] = [
    {
      ...spriteOption(entity, en.domain.appearanceDefault),
      value: '',
      draw: (ctx, size, palette) => {
        // The entity of the view, drawn faintly inside a dashed ring.
        ctx.save();
        ctx.globalAlpha = 0.55;
        spriteOption(entity, '').draw(ctx, size, palette);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
        ctx.strokeStyle = palette.inkMuted;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    },
    ...SPRITES.map((sprite) =>
      spriteOption(sprite, en.domain.sprites[sprite] ?? sprite, appearance?.tint),
    ),
  ];
  const tints: PictureOption[] = [
    tintOption(null, en.domain.appearanceTintNone),
    ...TINTS.map((tint) => tintOption(tint, en.domain.tints[tint] ?? tint)),
  ];

  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" data-testid="domain-appearance">
      <legend className="mb-1 p-0 text-xs font-medium text-muted">
        {en.domain.appearanceTitle}
      </legend>
      <PicturePicker
        label={en.domain.appearanceSprite}
        value={appearance?.sprite ?? ''}
        options={sprites}
        disabled={locked}
        error={error}
        onChange={(value) => {
          const sprite = SPRITES.find((s) => s === value);
          apply(
            sprite === undefined
              ? undefined
              : { sprite, ...(appearance?.tint !== undefined && { tint: appearance.tint }) },
          );
        }}
        data-testid="domain-field-appearance-sprite"
      />
      <PicturePicker
        label={en.domain.appearanceTint}
        value={appearance?.tint ?? ''}
        options={tints}
        disabled={locked}
        onChange={(value) => {
          const tint: Tint | undefined = TINTS.find((t) => t === value);
          apply({ sprite: appearance?.sprite ?? entity, ...(tint !== undefined && { tint }) });
        }}
        data-testid="domain-field-appearance-tint"
      />
      <p className="m-0 text-[11px] text-muted">{en.domain.appearanceHint}</p>
    </fieldset>
  );
}
