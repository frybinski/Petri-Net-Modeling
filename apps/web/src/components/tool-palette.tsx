import { Circle, MousePointer2, MoveRight, RectangleVertical, StickyNote } from 'lucide-react';
import type { ReactNode } from 'react';
import { en } from '../i18n/en';
import { commandById, shortcutText } from '../lib/commands';
import { useEditorStore, type Tool } from '../store/editor-store';
import { IconButton } from './ui/button';

const TOOLS: Array<{ tool: Tool; label: string; icon: ReactNode }> = [
  { tool: 'select', label: en.tools.select, icon: <MousePointer2 size={18} /> },
  { tool: 'place', label: en.tools.place, icon: <Circle size={18} /> },
  { tool: 'transition', label: en.tools.transition, icon: <RectangleVertical size={18} /> },
  { tool: 'arc', label: en.tools.arc, icon: <MoveRight size={18} /> },
  { tool: 'annotation', label: en.tools.annotation, icon: <StickyNote size={18} /> },
];

export function ToolPalette() {
  const tool = useEditorStore((s) => s.tool);
  const mode = useEditorStore((s) => s.mode);
  const setTool = useEditorStore((s) => s.setTool);
  return (
    <div
      role="toolbar"
      aria-label={en.tools.label}
      aria-orientation="vertical"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2"
    >
      {TOOLS.map(({ tool: id, label, icon }) => (
        <IconButton
          key={id}
          label={label}
          shortcut={shortcutText(commandById(`tool-${id}`))}
          pressed={tool === id}
          disabled={mode === 'simulate' && id !== 'select'}
          data-testid={`tool-${id}`}
          onClick={() => {
            setTool(id);
          }}
        >
          <span aria-hidden="true">{icon}</span>
        </IconButton>
      ))}
    </div>
  );
}
