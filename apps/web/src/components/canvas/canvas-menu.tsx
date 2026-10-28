import type { AlignMode, DistributeAxis } from '@pnm/core';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  Braces,
  Circle,
  ClipboardPaste,
  Copy,
  LayoutGrid,
  Maximize,
  Minus,
  Pencil,
  Plus,
  RectangleVertical,
  StickyNote,
  Tag,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { deleteSelection } from '../../lib/delete';
import { runAutoLayout } from '../../lib/layout-action';
import { getViewApi } from '../../lib/view-api';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore, type MenuTarget } from '../../store/ui-store';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from '../ui/context-menu';

const shortcut = (id: string): string => shortcutText(commandById(id));

function icon(Icon: LucideIcon) {
  return <Icon size={14} aria-hidden="true" />;
}

const ALIGN: Array<{ mode: AlignMode; label: string; icon: LucideIcon }> = [
  { mode: 'left', label: en.properties.alignLeft, icon: AlignStartVertical },
  { mode: 'center', label: en.properties.alignCenter, icon: AlignCenterVertical },
  { mode: 'right', label: en.properties.alignRight, icon: AlignEndVertical },
  { mode: 'top', label: en.properties.alignTop, icon: AlignStartHorizontal },
  { mode: 'middle', label: en.properties.alignMiddle, icon: AlignCenterHorizontal },
  { mode: 'bottom', label: en.properties.alignBottom, icon: AlignEndHorizontal },
];

const DISTRIBUTE: Array<{ axis: DistributeAxis; label: string; icon: LucideIcon }> = [
  { axis: 'horizontal', label: en.properties.distributeH, icon: AlignHorizontalSpaceAround },
  { axis: 'vertical', label: en.properties.distributeV, icon: AlignVerticalSpaceAround },
];

interface CanvasContextMenuProps {
  /** The element that opens the menu on a right click (it must accept a ref). */
  children: ReactElement;
}

/**
 * Right-click menu of the canvas. The canvas records what was clicked in `menuTarget`; the entries
 * depend on it: place, transition, arc, note, a group of elements, or the empty canvas.
 */
export function CanvasContextMenu({ children }: CanvasContextMenuProps) {
  const target = useUiStore((s) => s.menuTarget);
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          // Zoom buttons and the minimap have no menu.
          if ((event.target as Element).closest('.react-flow__panel, .react-flow__minimap')) {
            event.preventDefault();
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      {target ? <MenuContent target={target} /> : null}
    </ContextMenuRoot>
  );
}

function MenuContent({ target }: { target: MenuTarget }) {
  const simulating = useEditorStore((s) => s.mode === 'simulate');
  let entries: ReactElement;
  if (simulating) entries = <ViewEntries />;
  else if (target.kind === 'node' && target.id !== undefined)
    entries = <NodeEntries id={target.id} />;
  else if (target.kind === 'edge' && target.id !== undefined)
    entries = <EdgeEntries id={target.id} />;
  else if (target.kind === 'selection') entries = <SelectionEntries />;
  else entries = <PaneEntries position={target.position ?? { x: 0, y: 0 }} />;
  return <ContextMenuContent label={en.menu.contextMenu}>{entries}</ContextMenuContent>;
}

function ViewEntries() {
  return (
    <>
      <ContextMenuItem
        label={en.menu.selectAll}
        shortcut={shortcut('select-all')}
        onSelect={() => {
          useEditorStore.getState().selectAll();
        }}
      />
      <ContextMenuItem
        label={en.canvas.fitView}
        icon={icon(Maximize)}
        shortcut={shortcut('fit')}
        onSelect={() => {
          getViewApi()?.fitView();
        }}
      />
    </>
  );
}

function PaneEntries({ position }: { position: { x: number; y: number } }) {
  const hasClipboard = useEditorStore((s) => s.clipboard !== null);
  const add = (kind: 'place' | 'transition' | 'annotation'): void => {
    const store = useEditorStore.getState();
    const id =
      kind === 'place'
        ? store.addPlace(position)
        : kind === 'transition'
          ? store.addTransition(position)
          : store.addAnnotation(position);
    if (id !== null) store.startRename(id);
  };
  return (
    <>
      <ContextMenuItem
        label={en.menu.addPlaceHere}
        icon={icon(Circle)}
        shortcut={shortcut('tool-place')}
        onSelect={() => {
          add('place');
        }}
        data-testid="menu-add-place"
      />
      <ContextMenuItem
        label={en.menu.addTransitionHere}
        icon={icon(RectangleVertical)}
        shortcut={shortcut('tool-transition')}
        onSelect={() => {
          add('transition');
        }}
        data-testid="menu-add-transition"
      />
      <ContextMenuItem
        label={en.menu.addNoteHere}
        icon={icon(StickyNote)}
        shortcut={shortcut('tool-annotation')}
        onSelect={() => {
          add('annotation');
        }}
        data-testid="menu-add-note"
      />
      {hasClipboard ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            label={en.menu.paste}
            icon={icon(ClipboardPaste)}
            shortcut={shortcut('paste')}
            onSelect={() => {
              useEditorStore.getState().paste();
            }}
            data-testid="menu-paste"
          />
        </>
      ) : null}
      <ContextMenuSeparator />
      <ViewEntries />
      <ContextMenuSub label={en.menu.autoLayout} icon={icon(LayoutGrid)}>
        <ContextMenuItem
          label={en.menu.layoutRight}
          icon={icon(ArrowRight)}
          shortcut={shortcut('layout')}
          onSelect={() => {
            void runAutoLayout('RIGHT');
          }}
        />
        <ContextMenuItem
          label={en.menu.layoutDown}
          icon={icon(ArrowDown)}
          onSelect={() => {
            void runAutoLayout('DOWN');
          }}
        />
      </ContextMenuSub>
    </>
  );
}

function NodeEntries({ id }: { id: string }) {
  const place = useEditorStore((s) => s.net.places.find((p) => p.id === id));
  const transition = useEditorStore((s) => s.net.transitions.find((t) => t.id === id));
  const json = useEditorStore((s) => s.net.profile === 'json-net');
  const types = useEditorStore((s) => s.net.types);
  const rename = (
    <ContextMenuItem
      label={en.menu.rename}
      icon={icon(Pencil)}
      shortcut={shortcut('rename')}
      onSelect={() => {
        useEditorStore.getState().startRename(id);
      }}
      data-testid="menu-rename"
    />
  );
  const common = (
    <>
      <ContextMenuItem
        label={en.menu.duplicate}
        icon={icon(Copy)}
        shortcut={shortcut('duplicate')}
        onSelect={() => {
          useEditorStore.getState().duplicate();
        }}
        data-testid="menu-duplicate"
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.menu.delete}
        icon={icon(Trash2)}
        shortcut="Del"
        danger
        onSelect={deleteSelection}
        data-testid="menu-delete"
      />
    </>
  );

  if (place) {
    const knownType = place.type !== undefined && Object.hasOwn(types, place.type);
    return (
      <>
        {rename}
        <ContextMenuSeparator />
        <ContextMenuItem
          label={en.menu.addToken}
          icon={icon(Plus)}
          shortcut="+"
          onSelect={() => {
            useEditorStore.getState().adjustTokens(1);
          }}
          data-testid="menu-add-token"
        />
        <ContextMenuItem
          label={en.menu.removeToken}
          icon={icon(Minus)}
          shortcut="-"
          onSelect={() => {
            useEditorStore.getState().adjustTokens(-1);
          }}
          data-testid="menu-remove-token"
        />
        {json ? (
          <ContextMenuSub label={en.menu.setType} icon={icon(Tag)}>
            <ContextMenuRadioGroup
              value={knownType ? (place.type ?? '') : ''}
              onValueChange={(value) => {
                useEditorStore.getState().setPlaceType(id, value === '' ? undefined : value);
              }}
            >
              <ContextMenuRadioItem value="" label={en.menu.noType} />
              {Object.keys(types).map((name) => (
                <ContextMenuRadioItem key={name} value={name} label={name} />
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuItem
              label={en.menu.newType}
              icon={icon(Plus)}
              onSelect={() => {
                useUiStore.getState().openTypeDialog(null);
              }}
            />
          </ContextMenuSub>
        ) : null}
        <ContextMenuSeparator />
        {common}
      </>
    );
  }
  if (transition) {
    return (
      <>
        {rename}
        {json ? (
          <ContextMenuItem
            label={en.menu.editGuard}
            icon={icon(Braces)}
            onSelect={() => {
              // The properties panel shows the transition now; its guard field takes the focus.
              setTimeout(() => {
                document.querySelector<HTMLElement>('[data-testid="prop-guard"]')?.focus();
              }, 0);
            }}
            data-testid="menu-edit-guard"
          />
        ) : null}
        <ContextMenuSeparator />
        {common}
      </>
    );
  }
  // A note.
  return (
    <>
      {rename}
      <ContextMenuSeparator />
      {common}
    </>
  );
}

function EdgeEntries({ id }: { id: string }) {
  const json = useEditorStore((s) => s.net.profile === 'json-net');
  return (
    <>
      <ContextMenuItem
        label={json ? en.menu.editInscription : en.menu.editWeight}
        icon={icon(Pencil)}
        shortcut={shortcut('rename')}
        onSelect={() => {
          useEditorStore.getState().startRename(id);
        }}
        data-testid="menu-edit-arc"
      />
      <ContextMenuItem
        label={en.properties.reverse}
        icon={icon(ArrowLeftRight)}
        onSelect={() => {
          useEditorStore.getState().reverseArc(id);
        }}
        data-testid="menu-reverse"
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.menu.delete}
        icon={icon(Trash2)}
        shortcut="Del"
        danger
        onSelect={deleteSelection}
        data-testid="menu-delete"
      />
    </>
  );
}

function SelectionEntries() {
  const count = useEditorStore((s) => s.selection.length);
  return (
    <>
      <ContextMenuSub label={en.properties.align} icon={icon(AlignStartVertical)}>
        {ALIGN.map((item) => (
          <ContextMenuItem
            key={item.mode}
            label={item.label}
            icon={icon(item.icon)}
            onSelect={() => {
              useEditorStore.getState().align(item.mode);
            }}
          />
        ))}
      </ContextMenuSub>
      <ContextMenuSub
        label={en.properties.distribute}
        icon={icon(AlignHorizontalSpaceAround)}
        disabled={count < 3}
      >
        {DISTRIBUTE.map((item) => (
          <ContextMenuItem
            key={item.axis}
            label={item.label}
            icon={icon(item.icon)}
            onSelect={() => {
              useEditorStore.getState().distribute(item.axis);
            }}
          />
        ))}
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.menu.duplicate}
        icon={icon(Copy)}
        shortcut={shortcut('duplicate')}
        onSelect={() => {
          useEditorStore.getState().duplicate();
        }}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        label={en.properties.deleteSelection}
        icon={icon(Trash2)}
        shortcut="Del"
        danger
        onSelect={deleteSelection}
        data-testid="menu-delete"
      />
    </>
  );
}
