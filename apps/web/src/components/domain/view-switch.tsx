import { Factory, Network, PanelsTopBottom } from 'lucide-react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { useUiStore, type ViewMode } from '../../store/ui-store';
import { Tooltip } from '../ui/tooltip';

const OPTIONS: Array<{
  mode: ViewMode;
  label: string;
  tip: string;
  command: string;
  icon: typeof Network;
}> = [
  { mode: 'net', label: en.domain.net, tip: en.domain.netTip, command: 'view-net', icon: Network },
  {
    mode: 'domain',
    label: en.domain.domain,
    tip: en.domain.domainTip,
    command: 'view-domain',
    icon: Factory,
  },
  {
    mode: 'both',
    label: en.domain.both,
    tip: en.domain.bothTip,
    command: 'view-both',
    icon: PanelsTopBottom,
  },
];

/** Segmented control in the header: net editor, domain view or both. */
export function ViewSwitch() {
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  return (
    <div
      role="group"
      aria-label={en.domain.viewSwitch}
      className="flex rounded-md border border-border-strong p-0.5"
      data-testid="view-switch"
    >
      {OPTIONS.map(({ mode, label, tip, command, icon: Icon }) => (
        <Tooltip key={mode} content={tip} shortcut={shortcutText(commandById(command))}>
          <button
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => {
              setViewMode(mode);
            }}
            data-testid={`view-${mode}`}
            className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
