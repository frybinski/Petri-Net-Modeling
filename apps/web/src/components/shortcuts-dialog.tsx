import { en } from '../i18n/en';
import { commands, shortcutText, type CommandGroup } from '../lib/commands';
import { useUiStore } from '../store/ui-store';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Kbd } from './ui/kbd';

const GROUPS: CommandGroup[] = ['tools', 'editing', 'view'];

const MOUSE = (
  <section className="mt-6" data-testid="mouse-help">
    <h3 className="mt-0 mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
      {en.shortcuts.mouseTitle}
    </h3>
    <dl className="m-0 flex flex-col gap-2 text-sm ">
      {en.shortcuts.mouse.map(([action, effect]) => (
        <div key={action} className="flex flex-col">
          <dt className="font-medium">{action}</dt>
          <dd className="m-0 text-xs text-muted">{effect}</dd>
        </div>
      ))}
    </dl>
  </section>
);

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const close = (): void => {
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      title={en.shortcuts.title}
      onClose={close}
      width="max-w-4xl"
      footer={<Button onClick={close}>{en.shortcuts.close}</Button>}
    >
      <div className="grid gap-5 md:grid-cols-3" data-testid="shortcuts-list">
        {GROUPS.map((group) => (
          <section key={group}>
            <h3 className="mt-0 mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
              {en.shortcuts.groups[group]}
            </h3>
            <dl className="m-0 flex flex-col gap-1.5">
              {commands
                .filter((c) => c.group === group && !c.hidden)
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                    <dt>{c.label}</dt>
                    <dd className="m-0 flex flex-wrap justify-end gap-1">
                      {shortcutText(c)
                        .split(' / ')
                        .map((text) => (
                          <Kbd key={text}>{text}</Kbd>
                        ))}
                    </dd>
                  </div>
                ))}
            </dl>
            {group === 'tools' ? MOUSE : null}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
