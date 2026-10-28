import { Panel, useReactFlow } from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { getViewApi } from '../../lib/view-api';
import { IconButton } from '../ui/button';

/** Zoom buttons in the lower left corner of the canvas. */
export function ZoomControls() {
  const { zoomIn, zoomOut } = useReactFlow();
  return (
    <Panel position="bottom-left" className="!m-3">
      <div
        role="group"
        aria-label={en.canvas.zoomControls}
        className="flex flex-col rounded-lg border border-border bg-surface p-0.5 shadow-panel"
      >
        <IconButton
          label={en.canvas.zoomIn}
          tooltip={en.canvas.zoomInTip}
          side="right"
          onClick={() => {
            void zoomIn({ duration: 150 });
          }}
          data-testid="zoom-in"
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={en.canvas.zoomOut}
          tooltip={en.canvas.zoomOutTip}
          side="right"
          onClick={() => {
            void zoomOut({ duration: 150 });
          }}
          data-testid="zoom-out"
        >
          <Minus size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={en.canvas.fitView}
          shortcut={shortcutText(commandById('fit'))}
          side="right"
          onClick={() => {
            getViewApi()?.fitView();
          }}
          data-testid="fit-view"
        >
          <Maximize size={15} aria-hidden="true" />
        </IconButton>
      </div>
    </Panel>
  );
}
