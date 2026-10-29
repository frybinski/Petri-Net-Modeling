import { Dices, Pause, Pencil, Play, RotateCcw, SkipBack, StepForward } from 'lucide-react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { formatClock } from '../../lib/sim-format';
import { SIM_SPEEDS, useEditorStore, type SimSpeed } from '../../store/editor-store';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { SectionTitle } from './section';
import { SourceDetails, SourceSwitch } from './source-section';

const shortcut = (id: string): string => shortcutText(commandById(id));

function StatusPill({
  playing,
  finished,
  waiting,
}: {
  playing: boolean;
  finished: boolean;
  /** A live feed that has played everything that arrived waits for the next event. */
  waiting: boolean;
}) {
  const [label, tone] = waiting
    ? [en.replay.statusWaiting, 'bg-warn-soft text-warn']
    : playing
      ? [en.simulation.statusPlaying, 'bg-accent-soft text-accent']
      : finished
        ? [en.simulation.statusFinished, 'bg-warn-soft text-warn']
        : [en.simulation.statusPaused, 'bg-surface-2 text-muted'];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
      role="status"
      data-testid="sim-status"
    >
      {label}
    </span>
  );
}

function SpeedControl() {
  const speed = useEditorStore((s) => s.simSpeed);
  const setSpeed = useEditorStore((s) => s.setSimSpeed);
  return (
    <div className="flex flex-col gap-1.5">
      <Tooltip content={en.simulation.speedTip} side="left">
        <span className="text-xs font-medium text-muted" id="sim-speed-label">
          {en.simulation.speed}
        </span>
      </Tooltip>
      <div
        role="group"
        aria-labelledby="sim-speed-label"
        className="flex rounded-md border border-border-strong p-0.5"
        data-testid="sim-speed"
      >
        {SIM_SPEEDS.map((option: SimSpeed) => (
          <button
            key={option}
            type="button"
            aria-pressed={speed === option}
            onClick={() => {
              setSpeed(option);
            }}
            data-testid={`sim-speed-${option}`}
            className="inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded px-0.5 text-[11px] font-medium text-muted tabular-nums transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            {en.simulation.speedValue(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Clock, play and pause, steps, reset and speed. */
export function SimControls() {
  const timed = useEditorStore((s) => s.simTimed);
  const playing = useEditorStore((s) => s.simPlaying);
  const time = useEditorStore((s) => s.simTime);
  const cases = useEditorStore((s) => s.simMetrics?.casesInSystem ?? 0);
  const canBack = useEditorStore((s) => s.simCanBack);
  const computing = useEditorStore((s) => s.computing);
  const idle = useEditorStore((s) => s.simIdle);
  const enabledCount = useEditorStore((s) => s.enabled.size);
  const source = useEditorStore((s) => s.simSource);
  const untimedRun = useEditorStore((s) => s.simUntimed);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const stepNext = useEditorStore((s) => s.stepNext);
  const stepRandom = useEditorStore((s) => s.stepRandom);
  const stepBack = useEditorStore((s) => s.stepBack);
  const reset = useEditorStore((s) => s.resetSimulation);
  const stop = useEditorStore((s) => s.stopSimulation);

  return (
    <section
      className="flex flex-col gap-3 border-b border-border px-4 py-3"
      aria-label={en.simulation.controls}
      data-testid="sim-controls"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <SectionTitle>{en.simulation.title}</SectionTitle>
        <StatusPill
          playing={playing}
          finished={idle && !playing && source !== 'live'}
          waiting={idle && source === 'live'}
        />
      </div>

      {untimedRun ? null : (
        <>
          <SourceSwitch />
          <SourceDetails />
        </>
      )}

      {timed ? (
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted">{en.simulation.clock}</span>
            <span
              className="font-mono text-2xl leading-8 font-semibold tabular-nums"
              data-testid="sim-clock"
            >
              {formatClock(time)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs font-medium text-muted">{en.simulation.casesInSystem}</span>
            <span className="text-2xl leading-8 font-semibold tabular-nums" data-testid="sim-cases">
              {cases}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5">
        <Tooltip
          content={playing ? en.simulation.pauseTip : en.simulation.playTip}
          shortcut={shortcut('sim-play')}
          side="bottom"
        >
          <Button
            variant="primary"
            icon={
              playing ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )
            }
            onClick={togglePlaying}
            aria-pressed={playing}
            data-testid="sim-play"
          >
            {playing ? en.simulation.pause : en.simulation.play}
          </Button>
        </Tooltip>
        {timed ? (
          <Tooltip content={en.simulation.stepTip} shortcut={shortcut('sim-step')} side="bottom">
            <Button
              icon={<StepForward size={14} aria-hidden="true" />}
              onClick={() => {
                void stepNext();
              }}
              disabled={computing}
              data-testid="sim-step-next"
            >
              {en.simulation.step}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip
            content={en.simulation.stepRandomTip}
            shortcut={shortcut('sim-step')}
            side="bottom"
          >
            <Button
              icon={<Dices size={14} aria-hidden="true" />}
              onClick={() => {
                void stepRandom();
              }}
              disabled={computing || enabledCount === 0}
              data-testid="step-random"
            >
              {en.simulation.stepRandom}
            </Button>
          </Tooltip>
        )}
        <Tooltip content={en.simulation.stepBackTip} shortcut={shortcut('sim-back')} side="bottom">
          <Button
            icon={<SkipBack size={14} aria-hidden="true" />}
            onClick={() => {
              void stepBack();
            }}
            disabled={!canBack || computing}
            data-testid="sim-back"
          >
            {en.simulation.stepBack}
          </Button>
        </Tooltip>
        <Tooltip content={en.simulation.resetTip} shortcut={shortcut('sim-reset')} side="bottom">
          <Button
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={() => {
              void reset();
            }}
            data-testid="sim-reset"
          >
            {en.simulation.reset}
          </Button>
        </Tooltip>
      </div>

      <SpeedControl />

      <Button
        variant="ghost"
        icon={<Pencil size={14} aria-hidden="true" />}
        onClick={stop}
        className="self-start"
        data-testid="sim-exit"
      >
        {en.simulation.exit}
      </Button>
    </section>
  );
}
