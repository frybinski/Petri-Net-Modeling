import { en } from '../i18n/en';
import { useUiStore } from '../store/ui-store';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export function ConfirmDialog() {
  const request = useUiStore((s) => s.confirm);
  const close = useUiStore((s) => s.closeConfirm);
  return (
    <Dialog
      open={request !== null}
      title={request?.title ?? ''}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{en.files.cancel}</Button>
          <Button
            variant="primary"
            data-testid="confirm-accept"
            onClick={() => {
              const action = request?.onConfirm;
              close();
              action?.();
            }}
          >
            {request?.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-muted">{request?.message}</p>
    </Dialog>
  );
}
