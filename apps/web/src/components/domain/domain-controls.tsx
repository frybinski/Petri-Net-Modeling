import {
  ChevronUp,
  Dices,
  Eye,
  Move,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SkipBack,
  SlidersHorizontal,
  StepForward,
} from 'lucide-react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { formatClock } from '../../lib/sim-format';
import { SIM_SPEEDS, useEditorStore, type SimSpeed } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';
import { Tooltip } from '../ui/tooltip';

const shortcut = (id: string): string => shortcutText(commandById(id));

const modeButton =
  'inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast';

const iconButton =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40';

/** The floating bar at the top of the domain view: start the simulation, or run it. */
export function DomainControls() {
  const visible = useUiStore((s) => s.domainControls);
  const toggle = useUiStore((s) => s.toggleDomainControls);
  const mode = useEditorStore((s) => s.mode);
  const timed = useEditorStore((s) => s.simTimed);
  const playing = useEditorStore((s) => s.simPlaying);
  const time = useEditorStore((s) => s.simTime);
  const cases = useEditorStore((s) => s.simMetrics?.casesInSystem ?? 0);
  const speed = useEditorStore((s) => s.simSpeed);
  const canBack = useEditorStore((s) => s.simCanBack);
  const computing = useEditorStore((s) => s.computing);
  const enabledCount = useEditorStore((s) => s.enabled.size);
  const start = useEditorStore((s) => s.startSimulation);
  const stop = useEditorStore((s) => s.stopSimulation);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const stepNext = useEditorStore((s) => s.stepNext);
  const stepRandom = useEditorStore((s) => s.stepRandom);
  const stepBack = useEditorStore((s) => s.stepBack);
  const reset = useEditorStore((s) => s.resetSimulation);
  const setSpeed = useEditorStore((s) => s.setSimSpeed);
  const simulating = mode === 'simulate';
  const editLayout = useUiStore((s) => s.domainEdit);
  const setEditLayout = useUiStore((s) => s.setDomainEdit);

  if (!visible) {
    return (
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
        <div
          className="pointer-events-auto rounded-lg border border-border bg-surface p-0.5 shadow-panel"
          data-domain-overlay="top"
        >
          <IconButton
            label={en.domain.showBar}
            onClick={toggle}
            size="sm"
            data-testid="domain-controls-show"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
      <div
        role="toolbar"
        aria-label={en.domain.bar}
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-1 gap-y-0.5 rounded-lg border border-border bg-surface p-1 shadow-panel"
        data-testid="domain-controls"
        data-domain-overlay="top"
      >
        {!simulating ? (
          <>
            <Tooltip content={en.domain.startTip} shortcut={shortcut('simulate')}>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={13} aria-hidden="true" />}
                onClick={start}
                data-testid="domain-simulate"
              >
                {en.menu.simulate}
              </Button>
            </Tooltip>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <div
              role="group"
              aria-label={en.domain.modeGroup}
              className="flex rounded-md border border-border-strong p-0.5"
              data-testid="domain-mode"
            >
              <Tooltip content={en.domain.inspectTip}>
                <button
                  type="button"
                  aria-pressed={!editLayout}
                  onClick={() => {
                    setEditLayout(false);
                  }}
                  data-testid="domain-mode-inspect"
                  className={modeButton}
                >
                  <Eye size={13} aria-hidden="true" />
                  {en.domain.inspect}
                </button>
              </Tooltip>
              <Tooltip content={en.domain.editTip} shortcut={shortcut('domain-edit')}>
                <button
                  type="button"
                  aria-pressed={editLayout}
                  onClick={() => {
                    setEditLayout(true);
                  }}
                  data-testid="domain-mode-edit"
                  className={modeButton}
                >
                  <Move size={13} aria-hidden="true" />
                  {en.domain.editLayout}
                </button>
              </Tooltip>
            </div>
          </>
        ) : (
          <>
            <Tooltip
              content={playing ? en.simulation.pauseTip : en.simulation.playTip}
              shortcut={shortcut('sim-play')}
            >
              <button
                type="button"
                aria-label={playing ? en.simulation.pause : en.simulation.play}
                aria-pressed={playing}
                onClick={togglePlaying}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-contrast transition-colors hover:bg-accent-hover"
                data-testid="domain-play"
              >
                {playing ? (
                  <Pause size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
              </button>
            </Tooltip>
            {timed ? (
              <Tooltip content={en.simulation.stepTip} shortcut={shortcut('sim-step')}>
                <button
                  type="button"
                  aria-label={en.simulation.step}
                  disabled={computing}
                  onClick={() => {
                    void stepNext();
                  }}
                  className={iconButton}
                  data-testid="domain-step"
                >
                  <StepForward size={15} aria-hidden="true" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={en.simulation.stepRandomTip} shortcut={shortcut('sim-step')}>
                <button
                  type="button"
                  aria-label={en.simulation.stepRandom}
                  disabled={computing || enabledCount === 0}
                  onClick={() => {
                    void stepRandom();
                  }}
                  className={iconButton}
                  data-testid="domain-step"
                >
                  <Dices size={15} aria-hidden="true" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={en.simulation.stepBackTip} shortcut={shortcut('sim-back')}>
              <button
                type="button"
                aria-label={en.simulation.stepBack}
                disabled={!canBack || computing}
                onClick={() => {
                  void stepBack();
                }}
                className={iconButton}
                data-testid="domain-back"
              >
                <SkipBack size={15} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content={en.simulation.resetTip} shortcut={shortcut('sim-reset')}>
              <button
                type="button"
                aria-label={en.simulation.reset}
                onClick={() => {
                  void reset();
                }}
                className={iconButton}
                data-testid="domain-reset"
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            </Tooltip>

            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Tooltip content={en.simulation.speedTip}>
              <div
                role="group"
                aria-label={en.domain.barSpeed}
                className="flex rounded-md border border-border-strong p-0.5"
                data-testid="domain-speed"
              >
                {SIM_SPEEDS.map((option: SimSpeed) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={speed === option}
                    onClick={() => {
                      setSpeed(option);
                    }}
                    data-testid={`domain-speed-${option}`}
                    className="inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-[11px] font-medium text-muted tabular-nums transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
                  >
                    {en.simulation.speedValue(option)}
                  </button>
                ))}
              </div>
            </Tooltip>

            {timed ? (
              <>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-baseline gap-1.5 px-1" title={en.simulation.clock}>
                  <span className="sr-only">{en.simulation.clock}</span>
                  <span
                    className="font-mono text-sm font-semibold tabular-nums"
                    data-testid="domain-clock"
                  >
                    {formatClock(time)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 px-1 text-xs text-muted">
                  <span
                    className="font-semibold text-fg tabular-nums"
                    data-testid="domain-cases"
                    aria-label={en.simulation.casesInSystem}
                  >
                    {cases}
                  </span>
                  <span aria-hidden="true">{en.domain.kpiInSystem.toLowerCase()}</span>
                </div>
              </>
            ) : null}

            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Tooltip content={en.domain.exitTip} shortcut={shortcut('simulate')}>
              <Button
                variant="ghost"
                size="sm"
                icon={<Pencil size={13} aria-hidden="true" />}
                onClick={stop}
                data-testid="domain-exit"
              >
                {en.menu.edit}
              </Button>
            </Tooltip>
          </>
        )}
        <IconButton
          label={en.domain.hideBar}
          onClick={toggle}
          size="sm"
          data-testid="domain-controls-hide"
        >
          <ChevronUp size={15} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
