import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { en } from '../../i18n/en';
import { useImportStore } from '../../store/import-store';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

/** Lists what the PNML import did not understand, dropped or changed. */
export function ImportReportDialog() {
  const report = useImportStore((s) => s.report);
  const close = useImportStore((s) => s.close);
  if (!report) return null;
  const { warnings } = report;
  return (
    <Dialog
      open
      title={en.importReport.title}
      onClose={close}
      width="max-w-xl"
      footer={
        <Button variant="primary" onClick={close} data-testid="import-report-ok">
          {en.importReport.ok}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="import-report">
        <p className="m-0 flex items-start gap-2 text-sm font-medium">
          <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
          <span>
            {en.importReport.summary(
              report.netName || report.fileName,
              report.places,
              report.transitions,
              report.arcs,
            )}
          </span>
        </p>
        {report.laidOut ? (
          <p
            className="m-0 rounded-md bg-surface-2 px-2.5 py-2 text-xs"
            data-testid="import-laid-out"
          >
            {en.importReport.laidOut}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <>
            <p className="m-0 text-sm">{en.importReport.intro(warnings.length)}</p>
            <ul
              aria-label={en.importReport.list}
              className="m-0 flex max-h-72 list-none flex-col gap-1.5 overflow-auto p-0"
              data-testid="import-warnings"
            >
              {warnings.map((warning, index) => (
                <li key={`${index}:${warning}`} className="flex items-start gap-2 text-xs">
                  <AlertTriangle
                    size={13}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-warn"
                  />
                  <span className="min-w-0 break-words">{warning}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="m-0 text-xs text-muted">{en.importReport.none}</p>
        )}
      </div>
    </Dialog>
  );
}
