import { checkToken, tokenLabel } from '@pnm/core';
import { AlertTriangle, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';

/** Table of the initial tokens of a place (JSON nets). */
export function TokensSection({ placeId }: { placeId: string }) {
  const net = useEditorStore((s) => s.net);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const removeToken = useEditorStore((s) => s.removeToken);
  const duplicateToken = useEditorStore((s) => s.duplicateToken);
  const openTokenDialog = useUiStore((s) => s.openTokenDialog);
  const tokens = net.marking[placeId] ?? [];

  return (
    <div className="flex flex-col gap-2" data-testid="tokens-section">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{en.tokens.initial}</span>
        <span className="text-xs text-muted tabular-nums" data-testid="token-total">
          {en.tokens.total(tokens.length)}
        </span>
      </div>
      {tokens.length === 0 ? (
        <p className="m-0 text-sm text-muted">{en.tokens.empty}</p>
      ) : (
        <ol
          className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0"
          data-testid="token-list"
        >
          {tokens.map((token, index) => {
            const verdict = checkToken(net, placeId, token);
            const label = tokenLabel(token, 26);
            return (
              <li
                // Tokens have no identity; the index is the only stable handle.
                key={index}
                className="flex items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-2"
                data-testid="token-item"
              >
                <span className="w-5 shrink-0 text-[11px] text-muted tabular-nums">
                  {index + 1}
                </span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    openTokenDialog(placeId, index);
                  }}
                  className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:underline disabled:no-underline"
                  title={JSON.stringify(token)}
                >
                  {label}
                </button>
                {verdict.ok ? null : (
                  <span
                    className="text-danger"
                    role="img"
                    aria-label={verdict.errors.join('; ')}
                    title={verdict.errors.join('\n')}
                    data-testid="token-mismatch"
                  >
                    <AlertTriangle size={14} aria-hidden="true" />
                  </span>
                )}
                <IconButton
                  size="sm"
                  label={`${en.tokens.edit} ${index + 1}`}
                  disabled={locked}
                  onClick={() => {
                    openTokenDialog(placeId, index);
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  label={`${en.tokens.duplicate} ${index + 1}`}
                  disabled={locked}
                  onClick={() => {
                    duplicateToken(placeId, index);
                  }}
                >
                  <Copy size={13} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  label={`${en.tokens.delete} ${index + 1}`}
                  disabled={locked}
                  onClick={() => {
                    removeToken(placeId, index);
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}
      <Button
        icon={<Plus size={14} aria-hidden="true" />}
        disabled={locked}
        onClick={() => {
          openTokenDialog(placeId, null);
        }}
        className="self-start"
        data-testid="token-add"
      >
        {en.tokens.add}
      </Button>
    </div>
  );
}
