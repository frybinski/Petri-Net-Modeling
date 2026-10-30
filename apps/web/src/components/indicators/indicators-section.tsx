import { indicatorProblems } from '@pnm/core';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { en } from '../../i18n/en';
import { describeIndicator } from '../../lib/indicator-format';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';

/**
 * The indicators of the net (`simulation.indicators`): a list with add, edit and remove. An
 * indicator that points to something the net no longer has is marked, not removed.
 */
export function IndicatorsSection() {
  const net = useEditorStore((s) => s.net);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const setIndicators = useEditorStore((s) => s.setIndicators);
  const open = useUiStore((s) => s.openIndicatorDialog);
  const indicators = net.simulation?.indicators ?? [];

  return (
    <div className="flex flex-col gap-2" data-testid="indicators-section">
      <p className="m-0 text-[11px] text-muted">{en.indicators.hint}</p>
      {indicators.length === 0 ? (
        <p className="m-0 text-sm text-muted" data-testid="indicator-empty">
          {en.indicators.empty}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="indicator-list">
          {indicators.map((indicator, index) => {
            const problems = indicatorProblems(net, indicator, indicators.slice(0, index));
            return (
              <li
                key={indicator.id}
                className={`flex items-start gap-1 rounded-md border py-1 pr-1 pl-2.5 ${
                  problems.length > 0 ? 'border-danger' : 'border-border'
                }`}
                data-testid="indicator-item"
                data-indicator-id={indicator.id}
              >
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    open(index);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left hover:underline disabled:no-underline"
                  title={en.indicators.editLabel(indicator.label)}
                  aria-label={en.indicators.editLabel(indicator.label)}
                >
                  <span className="max-w-full truncate text-sm font-medium">
                    {indicator.label === '' ? indicator.id : indicator.label}
                    {indicator.unit ? (
                      <span className="ml-1 text-xs font-normal text-muted">
                        ({indicator.unit})
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full text-[11px] font-normal text-muted">
                    {describeIndicator(net, indicator)}
                  </span>
                  {problems.length > 0 ? (
                    <span
                      className="flex items-start gap-1 text-[11px] font-normal text-danger"
                      data-testid="indicator-problem"
                    >
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{problems[0]?.message}</span>
                    </span>
                  ) : null}
                </button>
                <IconButton
                  size="sm"
                  label={en.indicators.edit}
                  disabled={locked}
                  onClick={() => {
                    open(index);
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  label={en.indicators.removeLabel(indicator.label)}
                  disabled={locked}
                  onClick={() => {
                    setIndicators(indicators.filter((_, i) => i !== index));
                  }}
                  data-testid="indicator-remove"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        size="sm"
        disabled={locked}
        onClick={() => {
          open(null);
        }}
        data-testid="indicator-add"
      >
        <Plus size={14} aria-hidden="true" />
        {en.indicators.add}
      </Button>
    </div>
  );
}
