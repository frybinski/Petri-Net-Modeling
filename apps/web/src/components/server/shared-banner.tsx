import { Eye, Pencil } from 'lucide-react';
import { en } from '../../i18n/en';
import { useCurrentLink } from '../../lib/server-actions';
import { useServerStore } from '../../store/server-store';
import { Button } from '../ui/button';

/**
 * The note on a page that was opened with a share link: what the link allows. A read-only link
 * blocks saving to the project (a copy can be saved); a link that can edit saves new versions.
 */
export function SharedBanner() {
  const link = useCurrentLink();
  const openDialog = useServerStore((s) => s.openDialog);
  if (link?.kind !== 'shared') return null;
  const readOnly = link.mode === 'read';
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-accent-soft px-3 py-1.5 text-xs text-fg"
      role="status"
      data-testid="shared-banner"
      data-mode={link.mode}
    >
      {readOnly ? (
        <Eye size={14} aria-hidden="true" className="shrink-0 text-accent" />
      ) : (
        <Pencil size={14} aria-hidden="true" className="shrink-0 text-accent" />
      )}
      <span className="min-w-0 flex-1">
        {readOnly ? en.server.bannerRead(link.name) : en.server.bannerWrite(link.name)}
      </span>
      {readOnly ? (
        <Button
          size="sm"
          onClick={() => {
            openDialog('save', { asCopy: true });
          }}
          data-testid="shared-banner-copy"
        >
          {en.server.bannerCopy}
        </Button>
      ) : null}
      <a
        href={import.meta.env.BASE_URL}
        className="text-accent underline underline-offset-2"
        data-testid="shared-banner-editor"
      >
        {en.server.bannerEditor}
      </a>
    </div>
  );
}
