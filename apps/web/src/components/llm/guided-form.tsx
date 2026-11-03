import { placeRoles, type Id, type PetriNet } from '@pnm/core';
import {
  EMOJI_FONT,
  SPRITES,
  TINTS,
  allowedIcons,
  counterPlaces,
  stagePlaces,
  type Appearance,
  type ChoiceProblem,
  type CounterChoice,
  type DisplayIcon,
  type Sprite,
  type ViewChoices,
} from '@pnm/domain';
import { Loader2, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { en } from '../../i18n/en';
import { pickConcept, suggestConceptsNow } from '../../lib/domain-generation';
import { isConfigured } from '../../lib/llm-settings';
import { useChoiceProblems } from '../../lib/use-choice-problems';
import { useEditorStore } from '../../store/editor-store';
import { useGenerationStore } from '../../store/generation-store';
import { useLlmStore } from '../../store/llm-store';
import { EmojiField } from '../domain/domain-emoji-field';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { NumberField, SelectField, TextField, inputClass } from '../ui/fields';
import { Segmented } from '../ui/segmented';

const EMOJI = '__emoji';
const LIKE_ENTITY = '';
/** The emoji that "Emoji…" starts with; the person types over it. */
const START_EMOJI = '⭐';

type Problems = ReadonlyMap<string, ChoiceProblem>;

function problemMap(problems: readonly ChoiceProblem[]): Problems {
  const map = new Map<string, ChoiceProblem>();
  for (const problem of problems) if (!map.has(problem.path)) map.set(problem.path, problem);
  return map;
}

function Heading({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {children}
      </h3>
      {hint ? <p className="m-0 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

const spriteLabel = (sprite: Sprite): string => en.domain.sprites[sprite] ?? sprite;

function EntityRow({
  choices,
  problems,
  set,
}: {
  choices: ViewChoices;
  problems: Problems;
  set: (next: ViewChoices) => void;
}) {
  const entity = choices.entity;
  const value = entity.emoji !== undefined ? EMOJI : (entity.sprite ?? 'dot');
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={en.llm.guided.singular}
          value={entity.singular}
          onCommit={(singular) => {
            set({ ...choices, entity: { ...entity, singular } });
          }}
          data-testid="guided-entity-singular"
        />
        <TextField
          label={en.llm.guided.plural}
          value={entity.plural}
          onCommit={(plural) => {
            set({ ...choices, entity: { ...entity, plural } });
          }}
          data-testid="guided-entity-plural"
        />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <SelectField
          label={en.llm.guided.entitySymbol}
          value={value}
          options={[
            ...SPRITES.map((sprite) => ({ value: sprite, label: spriteLabel(sprite) })),
            { value: EMOJI, label: en.llm.guided.emojiOption },
          ]}
          onChange={(next) => {
            const base = { singular: entity.singular, plural: entity.plural };
            if (next === EMOJI) {
              set({ ...choices, entity: { ...base, emoji: entity.emoji ?? START_EMOJI } });
            } else {
              const sprite = SPRITES.find((s) => s === next);
              if (sprite) set({ ...choices, entity: { ...base, sprite } });
            }
          }}
          data-testid="guided-entity-symbol"
        />
        {entity.emoji !== undefined ? (
          <EmojiField
            value={entity.emoji}
            error={problems.get('entity.emoji')?.message}
            onCommit={(emoji) => {
              const base = { singular: entity.singular, plural: entity.plural };
              set({
                ...choices,
                entity: emoji === undefined ? { ...base, sprite: 'dot' } : { ...base, emoji },
              });
            }}
            data-testid="guided-entity-emoji"
          />
        ) : null}
      </div>
    </div>
  );
}

function StageRow({
  net,
  id,
  choices,
  problems,
  set,
}: {
  net: PetriNet;
  id: Id;
  choices: ViewChoices;
  problems: Problems;
  set: (next: ViewChoices) => void;
}) {
  const look = choices.stages[id] ?? null;
  const name = net.places.find((p) => p.id === id)?.name ?? id;
  const value = look === null ? LIKE_ENTITY : look.emoji !== undefined ? EMOJI : look.sprite;
  const change = (next: Appearance | null): void => {
    set({ ...choices, stages: { ...choices.stages, [id]: next } });
  };
  return (
    <div
      className="grid items-start gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]"
      data-testid={`guided-stage-${id}`}
    >
      <span className="truncate pt-1.5 text-sm" title={name}>
        {name}
      </span>
      <SelectField
        label={`${name}: ${en.llm.guided.symbol}`}
        hideLabel
        value={value ?? LIKE_ENTITY}
        options={[
          { value: LIKE_ENTITY, label: en.llm.guided.likeEntity },
          ...SPRITES.map((sprite) => ({ value: sprite, label: spriteLabel(sprite) })),
          { value: EMOJI, label: en.llm.guided.emojiOption },
        ]}
        onChange={(next) => {
          if (next === LIKE_ENTITY) change(null);
          else if (next === EMOJI) change({ emoji: look?.emoji ?? START_EMOJI });
          else {
            const sprite = SPRITES.find((s) => s === next);
            if (sprite) change({ sprite, ...(look?.tint !== undefined && { tint: look.tint }) });
          }
        }}
        data-testid={`guided-stage-${id}-symbol`}
      />
      {look !== null && look.emoji !== undefined ? (
        <EmojiField
          value={look.emoji}
          error={problems.get(`stages.${id}.emoji`)?.message}
          onCommit={(emoji) => {
            change(emoji === undefined ? null : { emoji });
          }}
          data-testid={`guided-stage-${id}-emoji`}
        />
      ) : (
        <SelectField
          label={`${name}: ${en.llm.guided.color}`}
          hideLabel
          value={look?.tint ?? ''}
          disabled={look === null}
          options={[
            { value: '', label: en.llm.guided.noColor },
            ...TINTS.map((tint) => ({ value: tint, label: en.domain.tints[tint] ?? tint })),
          ]}
          onChange={(next) => {
            if (look === null || look.sprite === undefined) return;
            const tint = TINTS.find((t) => t === next);
            change({ sprite: look.sprite, ...(tint !== undefined && { tint }) });
          }}
          data-testid={`guided-stage-${id}-tint`}
        />
      )}
      {problems.get(`stages.${id}`) ? (
        <p role="alert" className="m-0 text-[11px] text-danger sm:col-span-3" data-field-error>
          {problems.get(`stages.${id}`)!.message}
        </p>
      ) : null}
    </div>
  );
}

function CounterRow({
  net,
  id,
  choices,
  problems,
  set,
}: {
  net: PetriNet;
  id: Id;
  choices: ViewChoices;
  problems: Problems;
  set: (next: ViewChoices) => void;
}) {
  const counter = choices.counters[id];
  const place = net.places.find((p) => p.id === id);
  const role = placeRoles(net).get(id) ?? 'case';
  if (!counter || !place) return null;
  const change = (patch: Partial<CounterChoice>): void => {
    const next: CounterChoice = { ...counter, ...patch };
    if (patch.icon === undefined && 'icon' in patch) delete next.icon;
    if (patch.emoji === undefined && 'emoji' in patch) delete next.emoji;
    set({ ...choices, counters: { ...choices.counters, [id]: next } });
  };
  const symbol = counter.emoji !== undefined ? EMOJI : (counter.icon ?? '');
  const icons = allowedIcons(role);
  const error =
    problems.get(`counters.${id}.max`) ??
    problems.get(`counters.${id}.per`) ??
    problems.get(`counters.${id}.icon`);
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border p-2.5"
      data-testid={`guided-counter-${id}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={place.name}>
          {place.name}
        </span>
        <span className="text-[11px] text-muted">
          {role === 'quantity' ? en.llm.guided.roleAmount : en.llm.guided.roleSink}
        </span>
      </div>
      <div className="grid items-start gap-2 sm:grid-cols-[auto_minmax(0,8rem)_minmax(0,1fr)]">
        <Segmented
          label={en.llm.guided.counterStyle}
          value={counter.style}
          options={(['number', 'fill', 'pictogram'] as const).map((value) => ({
            value,
            label: en.domain.displayStyles[value] ?? value,
          }))}
          onChange={(style) => {
            change({ style });
          }}
          data-testid={`guided-counter-${id}-style`}
        />
        {counter.style === 'fill' ? (
          <NumberField
            label={en.llm.guided.fullAt}
            value={counter.max}
            min={0.01}
            decimals={2}
            error={problems.get(`counters.${id}.max`)?.message}
            onCommit={(max) => {
              if (max !== undefined) change({ max });
            }}
            data-testid={`guided-counter-${id}-max`}
          />
        ) : counter.style === 'pictogram' ? (
          <NumberField
            label={en.llm.guided.perSymbol}
            value={counter.per}
            min={0.01}
            decimals={2}
            error={problems.get(`counters.${id}.per`)?.message}
            onCommit={(per) => {
              if (per !== undefined) change({ per });
            }}
            data-testid={`guided-counter-${id}-per`}
          />
        ) : (
          <span />
        )}
        <Checkbox
          label={en.llm.guided.history}
          checked={counter.history}
          onChange={(history) => {
            change({ history });
          }}
          data-testid={`guided-counter-${id}-history`}
        />
      </div>
      <div className="grid items-start gap-2 sm:grid-cols-2">
        <SelectField
          label={en.llm.guided.counterSymbol}
          value={symbol}
          error={counter.emoji === undefined ? error?.message : undefined}
          options={[
            { value: '', label: en.llm.guided.defaultSymbol },
            ...icons.map((icon) => ({
              value: icon,
              label: en.domain.displayIcons[icon] ?? icon,
            })),
            { value: EMOJI, label: en.llm.guided.emojiOption },
          ]}
          onChange={(next) => {
            if (next === '') change({ icon: undefined, emoji: undefined });
            else if (next === EMOJI)
              change({ icon: undefined, emoji: counter.emoji ?? START_EMOJI });
            else {
              const icon: DisplayIcon | undefined = icons.find((i) => i === next);
              if (icon) change({ icon, emoji: undefined });
            }
          }}
          data-testid={`guided-counter-${id}-symbol`}
        />
        {counter.emoji !== undefined ? (
          <EmojiField
            value={counter.emoji}
            error={problems.get(`counters.${id}.emoji`)?.message}
            onCommit={(emoji) => {
              change({ emoji, icon: undefined });
            }}
            data-testid={`guided-counter-${id}-emoji`}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The cards with the concepts that the model suggested; a click fills the form. */
function ConceptCards() {
  const suggestions = useGenerationStore((s) => s.suggestions);
  const picked = useGenerationStore((s) => s.concept);
  if (suggestions.concepts.length === 0 && suggestions.notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="guided-concepts">
      {suggestions.notes.map((note) => (
        <p key={note} className="m-0 text-xs text-muted" data-testid="guided-concept-note">
          {note}
        </p>
      ))}
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
        {suggestions.concepts.map((concept, index) => {
          const entity = concept.choices.entity;
          return (
            <li
              key={`${concept.title}-${index}`}
              className={`flex flex-col gap-1.5 rounded-md border p-2.5 ${picked === concept.title ? 'border-accent ring-1 ring-accent' : 'border-border'}`}
              data-testid="guided-concept"
              data-title={concept.title}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true" style={{ fontFamily: EMOJI_FONT }}>
                  {entity.emoji ?? ''}
                </span>
                {concept.title}
              </span>
              <span className="text-xs text-muted">{concept.idea}</span>
              <span className="text-[11px] text-muted">
                {concept.choices.setting} ·{' '}
                {entity.emoji ?? (entity.sprite !== undefined ? spriteLabel(entity.sprite) : '')}
              </span>
              {concept.dropped.length > 0 ? (
                <details className="text-[11px] text-warn" data-testid="guided-concept-dropped">
                  <summary className="cursor-pointer">
                    {en.llm.guided.droppedParts(concept.dropped.length)}
                  </summary>
                  <ul className="m-0 mt-1 list-disc pl-4">
                    {concept.dropped.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <Button
                size="sm"
                className="mt-auto self-start"
                onClick={() => {
                  pickConcept(index);
                }}
                data-testid="guided-concept-use"
              >
                {en.llm.guided.useConcept}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The form of the guided way: choices instead of a description, optionally filled by a concept. */
export function GuidedForm() {
  const net = useEditorStore((s) => s.net);
  const choices = useGenerationStore((s) => s.choices);
  const patch = useGenerationStore((s) => s.patch);
  const suggestions = useGenerationStore((s) => s.suggestions);
  const settings = useLlmStore((s) => s.settings);
  const problems = problemMap(useChoiceProblems());
  const stages = useMemo(() => stagePlaces(net), [net]);
  const counters = useMemo(() => counterPlaces(net), [net]);
  if (!choices) {
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-muted" role="status">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {en.llm.guided.loading}
      </p>
    );
  }
  const set = (next: ViewChoices): void => {
    patch({ choices: next });
  };
  return (
    <div className="flex flex-col gap-4" data-testid="llm-guided">
      <p className="m-0 text-xs text-muted">{en.llm.guided.intro}</p>

      <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={
              suggestions.busy ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 size={13} aria-hidden="true" />
              )
            }
            disabled={suggestions.busy || !isConfigured(settings)}
            onClick={() => {
              void suggestConceptsNow();
            }}
            data-testid="guided-suggest"
          >
            {suggestions.busy ? en.llm.guided.suggesting : en.llm.guided.suggest}
          </Button>
          <span className="text-[11px] text-muted">{en.llm.guided.suggestHint}</span>
        </div>
        {suggestions.error ? (
          <p role="alert" className="m-0 text-xs text-danger" data-testid="guided-suggest-error">
            {suggestions.error}
          </p>
        ) : null}
        <ConceptCards />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={en.llm.guided.setting}
          value={choices.setting}
          onCommit={(setting) => {
            set({ ...choices, setting });
          }}
          data-testid="guided-setting"
        />
        <TextField
          label={en.llm.guided.viewName}
          value={choices.viewName}
          placeholder={en.llm.guided.viewNamePlaceholder}
          onCommit={(viewName) => {
            set({ ...choices, viewName });
          }}
          data-testid="guided-view-name"
        />
      </div>

      <Heading>{en.llm.guided.entity}</Heading>
      <EntityRow choices={choices} problems={problems} set={set} />

      {stages.length > 0 ? (
        <>
          <Heading hint={en.llm.guided.stagesHint}>{en.llm.guided.stages}</Heading>
          <div className="flex flex-col gap-2" data-testid="guided-stages">
            {stages.map((id) => (
              <StageRow
                key={id}
                net={net}
                id={id}
                choices={choices}
                problems={problems}
                set={set}
              />
            ))}
          </div>
        </>
      ) : null}

      {counters.length > 0 ? (
        <>
          <Heading hint={en.llm.guided.countersHint}>{en.llm.guided.counters}</Heading>
          <div className="flex flex-col gap-2" data-testid="guided-counters">
            {counters.map((id) => (
              <CounterRow
                key={id}
                net={net}
                id={id}
                choices={choices}
                problems={problems}
                set={set}
              />
            ))}
          </div>
        </>
      ) : null}

      <Heading hint={en.llm.guided.promptOnly}>{en.llm.guided.layoutTitle}</Heading>
      <div className="grid gap-3 sm:grid-cols-2">
        <Segmented
          label={en.llm.guided.arrangement}
          value={choices.layout}
          options={(['left-to-right', 'top-to-bottom', 'editor'] as const).map((value) => ({
            value,
            label: en.llm.guided.layouts[value] ?? value,
          }))}
          onChange={(layout) => {
            set({ ...choices, layout });
          }}
          data-testid="guided-layout"
        />
        <Segmented
          label={en.llm.guided.equipment}
          value={choices.equipment}
          options={(['plain', 'zones', 'floorplan'] as const).map((value) => ({
            value,
            label: en.llm.guided.equipments[value] ?? value,
          }))}
          onChange={(equipment) => {
            set({ ...choices, equipment });
          }}
          data-testid="guided-equipment"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="guided-additions" className="text-xs font-medium text-muted">
          {en.llm.guided.additions}
        </label>
        <textarea
          id="guided-additions"
          rows={2}
          value={choices.additions}
          placeholder={en.llm.guided.additionsPlaceholder}
          className={`${inputClass} h-auto resize-y py-1.5`}
          data-testid="guided-additions"
          onChange={(event) => {
            set({ ...choices, additions: event.target.value });
          }}
        />
      </div>
    </div>
  );
}
