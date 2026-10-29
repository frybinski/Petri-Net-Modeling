import { Copy, FolderOpen, Link2, Loader2, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { en } from '../../i18n/en';
import { compareCounts, formatWhen } from '../../lib/server-format';
import {
  createProject,
  currentLink,
  openProjectGuarded,
  openVersion,
  reloadFromServer,
  useCurrentLink,
  useLoaded,
  type Loadable,
} from '../../lib/server-actions';
import {
  serverApi,
  type ProjectInfo,
  type ShareLink,
  type ShareMode,
  type TrashedProject,
} from '../../lib/server-api';
import { useEditorStore } from '../../store/editor-store';
import { useServerStore } from '../../store/server-store';
import { notify, useUiStore } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { inputClass } from '../ui/fields';

function ListState<T>({
  result,
  reload,
  children,
}: {
  result: Loadable<T>;
  reload: () => void;
  children: (value: T) => ReactNode;
}) {
  if (result.state === 'loading') {
    return (
      <p
        className="m-0 flex items-center gap-2 text-xs text-muted"
        role="status"
        data-testid="server-loading"
      >
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {en.server.loading}
      </p>
    );
  }
  if (result.state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2" data-testid="server-load-failed">
        <p className="m-0 text-xs text-danger" role="alert">
          {en.server.loadFailed(result.message)}
        </p>
        <Button size="sm" onClick={reload}>
          {en.server.retry}
        </Button>
      </div>
    );
  }
  return <>{children(result.value)}</>;
}

// --- Open from server -----------------------------------------------------------------------

function ProjectRow({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectInfo;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
      data-testid="server-project"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" data-testid="server-project-name">
            {project.name}
          </span>
          {project.shared.read || project.shared.write ? (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {en.server.sharedBadge}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[11px] text-muted">
          {en.server.versionLabel(project.version)} ·{' '}
          {en.server.changed(formatWhen(project.updatedAt))} ·{' '}
          {en.server.counts(project.places, project.transitions, project.arcs)}
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={onOpen}
        aria-label={en.server.openProjectLabel(project.name)}
      >
        {en.server.openProject}
      </Button>
      <IconButton
        size="sm"
        label={en.server.deleteProjectLabel(project.name)}
        tooltip={en.server.deleteProject}
        onClick={onDelete}
      >
        <Trash2 size={14} aria-hidden="true" />
      </IconButton>
    </li>
  );
}

function TrashRow({ project, onRestore }: { project: TrashedProject; onRestore: () => void }) {
  return (
    <li
      className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
      data-testid="server-trashed"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="truncate text-[11px] text-muted">
          {en.server.trashUntil(formatWhen(project.purgeAt))}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onRestore}
        aria-label={en.server.restoreLabel(project.name)}
        icon={<RotateCcw size={13} aria-hidden="true" />}
      >
        {en.server.restore}
      </Button>
    </li>
  );
}

function OpenForm() {
  const close = useServerStore((s) => s.closeDialog);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const [projects, reloadProjects] = useLoaded(() => serverApi.list());
  const [trash, reloadTrash] = useLoaded(() => serverApi.trash());
  const [showTrash, setShowTrash] = useState(false);
  const [query, setQuery] = useState('');
  const searchId = useId();

  const reload = (): void => {
    reloadProjects();
    reloadTrash();
  };

  const remove = (project: ProjectInfo): void => {
    askConfirm({
      title: en.server.deleteTitle,
      message: en.server.deleteMessage(project.name),
      confirmLabel: en.server.deleteConfirm,
      danger: true,
      onConfirm: () => {
        void serverApi.remove(project.id).then(
          () => {
            notify('success', en.server.deleted(project.name));
            reload();
          },
          (error: unknown) => {
            notify('error', en.server.saveFailed, {
              details: [error instanceof Error ? error.message : String(error)],
            });
          },
        );
      },
    });
  };

  const restore = (project: TrashedProject): void => {
    void serverApi.restore(project.id).then(
      () => {
        notify('success', en.server.restored(project.name));
        reload();
      },
      (error: unknown) => {
        notify('error', en.server.openFailed, {
          details: [error instanceof Error ? error.message : String(error)],
        });
      },
    );
  };

  const trashCount = trash.state === 'ready' ? trash.value.length : 0;

  return (
    <Dialog
      open
      title={en.server.openTitle}
      onClose={close}
      width="max-w-xl"
      footer={
        <>
          <Button
            onClick={() => {
              setShowTrash((v) => !v);
            }}
            aria-pressed={showTrash}
            data-testid="server-trash-toggle"
          >
            {showTrash ? en.server.trashHide : en.server.trashShow(trashCount)}
          </Button>
          <Button onClick={close} data-testid="server-close">
            {en.server.close}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="server-open-dialog">
        <p className="m-0 text-xs text-muted">{en.server.openIntro}</p>
        {showTrash ? (
          <ListState result={trash} reload={reloadTrash}>
            {(list) =>
              list.length === 0 ? (
                <p className="m-0 text-xs text-muted" data-testid="server-trash-empty">
                  {en.server.trashEmpty}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {list.map((project) => (
                    <TrashRow
                      key={project.id}
                      project={project}
                      onRestore={() => {
                        restore(project);
                      }}
                    />
                  ))}
                </ul>
              )
            }
          </ListState>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={searchId} className="text-xs font-medium text-muted">
                {en.server.search}
              </label>
              <input
                id={searchId}
                type="search"
                autoComplete="off"
                value={query}
                placeholder={en.server.searchPlaceholder}
                className={inputClass}
                data-testid="server-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <ListState result={projects} reload={reloadProjects}>
              {(list) => {
                const needle = query.trim().toLowerCase();
                const shown =
                  needle === '' ? list : list.filter((p) => p.name.toLowerCase().includes(needle));
                if (list.length === 0) {
                  return (
                    <p className="m-0 text-xs text-muted" data-testid="server-empty">
                      {en.server.empty}
                    </p>
                  );
                }
                if (shown.length === 0) {
                  return <p className="m-0 text-xs text-muted">{en.server.noMatch}</p>;
                }
                return (
                  <ul
                    className="m-0 max-h-80 list-none overflow-auto p-0"
                    data-testid="server-project-list"
                  >
                    {shown.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        onOpen={() => {
                          close();
                          openProjectGuarded(project);
                        }}
                        onDelete={() => {
                          remove(project);
                        }}
                      />
                    ))}
                  </ul>
                );
              }}
            </ListState>
          </>
        )}
      </div>
    </Dialog>
  );
}

// --- Save to server -------------------------------------------------------------------------

function SaveForm() {
  const close = useServerStore((s) => s.closeDialog);
  const asCopy = useServerStore((s) => s.saveAsCopy);
  const saving = useServerStore((s) => s.saving);
  const link = currentLink();
  const netName = useEditorStore((s) => s.net.name);
  const proposed = asCopy && link ? `${link.name} (copy)` : netName.trim();
  const [name, setName] = useState(proposed);
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The name is the only field: the cursor starts in it, with the proposal selected.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (): void => {
    if (name.trim() === '' || saving) return;
    void createProject(name.trim()).then((ok) => {
      if (ok) close();
    });
  };

  return (
    <Dialog
      open
      title={asCopy ? en.server.saveCopyTitle : en.server.saveTitle}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{en.server.cancel}</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={name.trim() === '' || saving}
            data-testid="server-save-confirm"
          >
            {saving ? en.server.saving : en.server.saveButton}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        data-testid="server-save-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="m-0 text-xs text-muted">
          {asCopy ? en.server.saveCopyIntro : en.server.saveIntro}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="text-xs font-medium text-muted">
            {en.server.projectName}
          </label>
          <input
            id={nameId}
            ref={inputRef}
            type="text"
            autoComplete="off"
            value={name}
            maxLength={200}
            className={inputClass}
            data-testid="server-project-name-input"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      </form>
    </Dialog>
  );
}

// --- Versions -------------------------------------------------------------------------------

function Delta({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className={n > 0 ? 'text-ok' : 'text-danger'} data-testid="version-delta">
      {' '}
      ({en.server.delta(n)})
    </span>
  );
}

function VersionsForm() {
  const close = useServerStore((s) => s.closeDialog);
  const link = useCurrentLink();
  const net = useEditorStore((s) => s.net);
  const projectId = link?.id ?? '';
  const [versions, reload] = useLoaded(() => serverApi.versions(projectId));
  const name = link?.name ?? '';

  return (
    <Dialog
      open
      title={en.server.versionsTitle(name)}
      onClose={close}
      width="max-w-2xl"
      footer={<Button onClick={close}>{en.server.close}</Button>}
    >
      <div className="flex flex-col gap-3" data-testid="server-versions-dialog">
        <p className="m-0 text-xs text-muted">{en.server.versionsIntro}</p>
        <ListState result={versions} reload={reload}>
          {(list) => {
            const newest = list[0]?.version ?? 0;
            return (
              <table className="w-full border-collapse text-left text-xs">
                <caption className="sr-only">{en.server.versionsTitle(name)}</caption>
                <thead>
                  <tr className="text-muted">
                    <th scope="col" className="py-1 pr-2 font-medium">
                      Version
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      {en.server.savedAt('').trim()}
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      {en.server.compare}
                    </th>
                    <th scope="col" className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((version) => {
                    const diff = compareCounts(version, net);
                    return (
                      <tr
                        key={version.version}
                        className="border-t border-border align-top"
                        data-testid="server-version"
                      >
                        <th scope="row" className="py-1.5 pr-2 font-medium">
                          v{version.version}
                          {version.version === newest ? (
                            <span className="ml-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                              {en.server.versionCurrent}
                            </span>
                          ) : null}
                          {version.note ? (
                            <div className="font-normal text-muted">{version.note}</div>
                          ) : null}
                        </th>
                        <td className="py-1.5 pr-2 text-muted">{formatWhen(version.savedAt)}</td>
                        <td className="py-1.5 pr-2" data-testid="server-version-counts">
                          {version.places} P<Delta n={diff.places} />, {version.transitions} T
                          <Delta n={diff.transitions} />, {version.arcs} A<Delta n={diff.arcs} />
                        </td>
                        <td className="py-1.5 text-right">
                          <Button
                            size="sm"
                            aria-label={en.server.versionOpenLabel(version.version)}
                            onClick={() => {
                              void openVersion(projectId, name, version, newest).then((ok) => {
                                if (ok) close();
                              });
                            }}
                          >
                            {en.server.versionOpen}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          }}
        </ListState>
      </div>
    </Dialog>
  );
}

// --- Share ----------------------------------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ShareRow({
  mode,
  link,
  busy,
  onCreate,
  onRotate,
  onRemove,
}: {
  mode: ShareMode;
  link: ShareLink | undefined;
  busy: boolean;
  onCreate: () => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const title = mode === 'read' ? en.server.shareRead : en.server.shareWrite;
  const hint = mode === 'read' ? en.server.shareReadHint : en.server.shareWriteHint;
  return (
    <section className="flex flex-col gap-1.5" aria-label={title} data-testid={`share-${mode}`}>
      <h3 className="m-0 text-xs font-semibold">{title}</h3>
      <p className="m-0 text-[11px] text-muted">{hint}</p>
      {link ? (
        <>
          <div className="flex gap-2">
            <input
              id={inputId}
              type="text"
              readOnly
              value={link.url}
              aria-label={en.server.shareLinkLabel(title)}
              className={`${inputClass} font-mono text-xs`}
              data-testid={`share-${mode}-url`}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button
              icon={<Copy size={13} aria-hidden="true" />}
              data-testid={`share-${mode}-copy`}
              onClick={() => {
                void copyText(link.url).then((ok) => {
                  notify(
                    ok ? 'success' : 'error',
                    ok ? en.server.shareCopied : en.server.shareCopyFailed,
                  );
                });
              }}
            >
              {en.server.shareCopy}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={onRotate}
              title={en.server.shareNewTip}
              data-testid={`share-${mode}-rotate`}
            >
              {en.server.shareNew}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={onRemove}
              data-testid={`share-${mode}-remove`}
            >
              {en.server.shareRemove}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button
            size="sm"
            disabled={busy}
            onClick={onCreate}
            icon={<Link2 size={13} aria-hidden="true" />}
            data-testid={`share-${mode}-create`}
          >
            {en.server.shareCreate}
          </Button>
        </div>
      )}
    </section>
  );
}

function ShareForm() {
  const close = useServerStore((s) => s.closeDialog);
  const link = useCurrentLink();
  const projectId = link?.id ?? '';
  const [loaded, reload] = useLoaded(() => serverApi.get(projectId));
  const [busy, setBusy] = useState(false);

  const change = (task: () => Promise<unknown>): void => {
    setBusy(true);
    void task()
      .then(reload, (error: unknown) => {
        notify('error', en.server.shareFailed, {
          details: [error instanceof Error ? error.message : String(error)],
        });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Dialog
      open
      title={en.server.shareTitle(link?.name ?? '')}
      onClose={close}
      footer={<Button onClick={close}>{en.server.close}</Button>}
    >
      <div className="flex flex-col gap-4" data-testid="server-share-dialog">
        <p className="m-0 text-xs text-muted">{en.server.shareIntro}</p>
        <ListState result={loaded} reload={reload}>
          {(value) => (
            <>
              {(['read', 'write'] as const).map((mode) => (
                <ShareRow
                  key={mode}
                  mode={mode}
                  link={value.shares[mode]}
                  busy={busy}
                  onCreate={() => {
                    change(() => serverApi.share(projectId, mode));
                  }}
                  onRotate={() => {
                    change(() => serverApi.share(projectId, mode, true));
                  }}
                  onRemove={() => {
                    change(() => serverApi.unshare(projectId, mode));
                  }}
                />
              ))}
            </>
          )}
        </ListState>
      </div>
    </Dialog>
  );
}

// --- Conflict -------------------------------------------------------------------------------

function ConflictDialog() {
  const conflict = useServerStore((s) => s.conflict);
  const setConflict = useServerStore((s) => s.setConflict);
  const openDialog = useServerStore((s) => s.openDialog);
  const close = (): void => {
    setConflict(null);
  };
  if (!conflict) return null;
  return (
    <Dialog
      open
      title={en.server.conflictTitle}
      onClose={close}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={close} data-testid="conflict-cancel">
            {en.server.cancel}
          </Button>
          <Button
            icon={<Share2 size={13} aria-hidden="true" />}
            data-testid="conflict-copy"
            onClick={() => {
              setConflict(null);
              openDialog('save', { asCopy: true });
            }}
          >
            {en.server.conflictCopy}
          </Button>
          <Button
            variant="primary"
            icon={<FolderOpen size={13} aria-hidden="true" />}
            data-testid="conflict-reload"
            onClick={() => {
              const link = conflict.link;
              setConflict(null);
              void reloadFromServer(link);
            }}
          >
            {en.server.conflictReload}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm" data-testid="server-conflict-dialog">
        <p className="m-0" role="alert">
          {en.server.conflictMessage(conflict.yours, conflict.current)}
        </p>
        <ul className="m-0 pl-5 text-xs text-muted">
          <li>
            <strong className="text-fg">{en.server.conflictReload}.</strong>{' '}
            {en.server.conflictReloadHint}
          </li>
          <li>
            <strong className="text-fg">{en.server.conflictCopy}.</strong>{' '}
            {en.server.conflictCopyHint}
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

/** The dialogs of the server functions; mounted once, each renders while its state asks for it. */
export function ServerDialogs() {
  const dialog = useServerStore((s) => s.dialog);
  // The versions and the share dialog are for a document that belongs to a project.
  const link = useCurrentLink();
  return (
    <>
      {dialog === 'open' ? <OpenForm /> : null}
      {dialog === 'save' ? <SaveForm /> : null}
      {dialog === 'versions' && link?.kind === 'project' ? <VersionsForm /> : null}
      {dialog === 'share' && link?.kind === 'project' ? <ShareForm /> : null}
      <ConflictDialog />
    </>
  );
}
