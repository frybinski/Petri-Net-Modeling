import {
  entryOf,
  kindChoices,
  type DomainView,
  type EntryRef,
  type Point,
  type Decor,
} from '@pnm/domain';
import {
  Braces,
  Eye,
  EyeOff,
  Maximize,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import {
  addDecorAt,
  addPointAt,
  addSlotAt,
  changeKind,
  deleteSelectedEntry,
  editJson,
  hasLabel,
  hideSelected,
  pathOf,
  removePointAt,
  removeSlotAt,
  resetToGeneric,
  showSelected,
  startLabelEdit,
} from '../../lib/domain-edit';
import { analyseDomainView } from '../../lib/domain-view';
import { getDomainViewApi } from '../../lib/domain-view-api';
import { useDomainEditStore, type DomainMenuTarget } from '../../store/domain-edit-store';
import { useEditorStore } from '../../store/editor-store';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
} from '../ui/context-menu';

const icon = (Icon: LucideIcon) => <Icon size={14} aria-hidden="true" />;
const shortcut = (id: string): string => shortcutText(commandById(id));

const DECOR_KINDS: Array<{ kind: Decor['kind']; label: string }> = [
  { kind: 'room', label: en.domain.addRoom },
  { kind: 'zone', label: en.domain.addZone },
  { kind: 'wall', label: en.domain.addWall },
  { kind: 'label', label: en.domain.addLabel },
  { kind: 'furniture', label: en.domain.addFurniture },
  { kind: 'scale', label: en.domain.addScale },
];

/** The kind of the entry as the view stores it (`hidden`, `station`, ...), for the checks. */
function kindOf(view: DomainView, entry: EntryRef): string | null {
  const found = entryOf(view, entry);
  return found && 'kind' in found ? found.kind : null;
}

/**
 * Right-click menu of the domain view in the mode "Edit layout". What it offers depends on what
 * was clicked: an entry of the view, a piece of decor, or the empty sheet.
 */
export function DomainContextMenu() {
  const target = useDomainEditStore((s) => s.menu);
  const net = useEditorStore((s) => s.net);
  const view = useMemo(() => analyseDomainView(net).validation?.view ?? null, [net]);
  if (!target || !view) return null;
  let entries: ReactElement;
  if (target.entry === null) entries = <EmptyEntries target={target} />;
  else if (target.entry.section === 'decor') {
    entries = <DecorEntries entry={target.entry} view={view} />;
  } else entries = <ElementEntries entry={target.entry} view={view} target={target} />;
  return <ContextMenuContent label={en.domain.menuLabel}>{entries}</ContextMenuContent>;
}

function EmptyEntries({ target }: { target: DomainMenuTarget }) {
  const at: Point = target.at;
  return (
    <>
      {DECOR_KINDS.map(({ kind, label }) => (
        <ContextMenuItem
          key={kind}
          label={label}
          icon={icon(Shapes)}
          onSelect={() => {
            addDecorAt(kind, at);
          }}
          data-testid={`domain-menu-add-${kind}`}
        />
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.domain.fit}
        icon={icon(Maximize)}
        shortcut={shortcut('fit')}
        onSelect={() => {
          getDomainViewApi()?.fitView();
        }}
      />
    </>
  );
}

function DecorEntries({ entry, view }: { entry: EntryRef; view: DomainView }) {
  return (
    <>
      {hasLabel(view, entry) ? (
        <ContextMenuItem
          label={en.domain.editLabel}
          icon={icon(Pencil)}
          shortcut={shortcut('rename')}
          onSelect={() => {
            startLabelEdit(entry);
          }}
          data-testid="domain-menu-rename"
        />
      ) : null}
      <ContextMenuItem
        label={en.domain.editJson}
        icon={icon(Braces)}
        onSelect={() => {
          editJson(entry);
        }}
        data-testid="domain-menu-json"
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.domain.removeDecor}
        icon={icon(Trash2)}
        shortcut="Del"
        danger
        onSelect={() => {
          deleteSelectedEntry();
        }}
        data-testid="domain-menu-remove"
      />
    </>
  );
}

function ElementEntries({
  entry,
  view,
  target,
}: {
  entry: EntryRef;
  view: DomainView;
  target: DomainMenuTarget;
}) {
  const net = useEditorStore((s) => s.net);
  const kind = kindOf(view, entry);
  const hidden = kind === 'hidden';
  const choices = hidden || entry.section === 'arcs' ? [] : kindChoices(net, entry);
  const path = pathOf(view, entry);
  const found = entryOf(view, entry);
  const slots = found && 'slots' in found ? found.slots : undefined;
  const isCard = kind !== null && ['station', 'machine', 'gate', 'area', 'rooms'].includes(kind);
  const at = target.at;
  return (
    <>
      {hasLabel(view, entry) ? (
        <ContextMenuItem
          label={en.domain.editLabel}
          icon={icon(Pencil)}
          shortcut={shortcut('rename')}
          onSelect={() => {
            startLabelEdit(entry);
          }}
          data-testid="domain-menu-rename"
        />
      ) : null}
      {choices.length > 1 ? (
        <ContextMenuSub label={en.domain.changeKind} icon={icon(Shapes)}>
          <ContextMenuRadioGroup
            value={kind ?? ''}
            onValueChange={(value) => {
              changeKind(entry, value);
            }}
          >
            {choices.map((choice) => (
              <ContextMenuRadioItem
                key={choice}
                value={choice}
                label={en.domain.kinds[choice] ?? choice}
                data-testid={`domain-menu-kind-${choice}`}
              />
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSub>
      ) : null}
      {path ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            label={en.domain.addPoint}
            icon={icon(Plus)}
            onSelect={() => {
              addPointAt(entry, at);
            }}
            data-testid="domain-menu-add-point"
          />
          <ContextMenuItem
            label={en.domain.removePoint}
            icon={icon(Minus)}
            disabled={path.length <= 2}
            onSelect={() => {
              removePointAt(entry, at);
            }}
            data-testid="domain-menu-remove-point"
          />
        </>
      ) : null}
      {isCard && !hidden ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            label={en.domain.addSlot}
            icon={icon(Plus)}
            onSelect={() => {
              addSlotAt(entry, at);
            }}
            data-testid="domain-menu-add-slot"
          />
          <ContextMenuItem
            label={en.domain.removeSlot}
            icon={icon(Minus)}
            disabled={(slots?.length ?? 0) === 0}
            onSelect={() => {
              removeSlotAt(entry, at);
            }}
            data-testid="domain-menu-remove-slot"
          />
        </>
      ) : null}
      <ContextMenuSeparator />
      {entry.section !== 'arcs' ? (
        hidden ? (
          <ContextMenuItem
            label={en.domain.show}
            icon={icon(Eye)}
            onSelect={() => {
              showSelected(entry);
            }}
            data-testid="domain-menu-show"
          />
        ) : (
          <ContextMenuItem
            label={en.domain.hide}
            icon={icon(EyeOff)}
            shortcut="Del"
            onSelect={() => {
              hideSelected();
            }}
            data-testid="domain-menu-hide"
          />
        )
      ) : null}
      <ContextMenuItem
        label={en.domain.resetEntry}
        icon={icon(RotateCcw)}
        onSelect={() => {
          resetToGeneric(entry);
        }}
        data-testid="domain-menu-reset"
      />
      <ContextMenuItem
        label={en.domain.editJson}
        icon={icon(Braces)}
        onSelect={() => {
          editJson(entry);
        }}
        data-testid="domain-menu-json"
      />
    </>
  );
}
