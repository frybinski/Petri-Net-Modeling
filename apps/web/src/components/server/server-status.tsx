import { Server } from 'lucide-react';
import { en } from '../../i18n/en';
import { useCurrentLink } from '../../lib/server-actions';
import { useEditorStore, selectIsDirty } from '../../store/editor-store';
import { useServerStore } from '../../store/server-store';

/** In the status bar: which server this is and which of its projects the document belongs to. */
export function ServerStatus() {
  const status = useServerStore((s) => s.status);
  const name = useServerStore((s) => s.health?.name ?? '');
  const saving = useServerStore((s) => s.saving);
  const link = useCurrentLink();
  const dirty = useEditorStore(selectIsDirty);
  if (status !== 'present') return null;
  const project = link
    ? link.kind === 'shared' && link.mode === 'read'
      ? `${link.name} · ${en.server.statusSharedRead}`
      : en.server.statusProject(link.name, link.version)
    : null;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      data-testid="status-server"
      title={en.server.statusTip}
      aria-busy={saving}
    >
      <Server size={13} aria-hidden="true" className="shrink-0 text-ok" />
      <span className="truncate">{en.server.name(name)}</span>
      {project ? (
        <span className="truncate text-fg" data-testid="status-server-project">
          · {project}
          {dirty ? ' *' : ''}
        </span>
      ) : null}
    </span>
  );
}
