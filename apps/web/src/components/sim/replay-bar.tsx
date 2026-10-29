import { ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';
import { IconButton } from '../ui/button';

/**
 * The control strip of a replay: a recorded firing sequence of an analysis (a counterexample, the
 * way into a deadlock or into a state) played step by step in the simulation.
 */
export function ReplayBar() {
  const t = en.analysis.replay;
  const replay = useEditorStore((s) => s.replay);
  const playing = useEditorStore((s) => s.replayPlaying);
  const computing = useEditorStore((s) => s.computing);
  const step = useEditorStore((s) => s.replayStep);
  const setPlaying = useEditorStore((s) => s.setReplayPlaying);
  const restart = useEditorStore((s) => s.restartReplay);
  const end = useEditorStore((s) => s.endReplay);
  if (!replay) return null;
  const total = replay.steps.length;
  const finished = replay.status !== 'ready';
  const message =
    replay.status === 'diverged'
      ? t.diverged
      : replay.status === 'done'
        ? replay.reached === true
          ? t.reached
          : replay.reached === false
            ? t.notReached
            : t.done
        : null;
  return (
    <section
      className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-accent-soft px-4 py-2.5"
      aria-label={t.title}
      data-testid="replay-bar"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-semibold text-accent" data-testid="replay-label">
            {t.label}: {replay.label}
          </span>
          <span className="text-[11px] text-muted tabular-nums" data-testid="replay-position">
            {t.stepOf(replay.position, total)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t.step}
            tooltip={t.stepTip}
            size="sm"
            disabled={finished || computing}
            onClick={() => {
              setPlaying(false);
              void step();
            }}
            data-testid="replay-step"
          >
            <ChevronRight size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={playing ? t.pause : t.play}
            size="sm"
            disabled={finished}
            onClick={() => {
              setPlaying(!playing);
            }}
            data-testid="replay-play"
          >
            {playing ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            label={t.restart}
            size="sm"
            disabled={computing}
            onClick={() => {
              void restart();
            }}
            data-testid="replay-restart"
          >
            <RotateCcw size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t.close}
            tooltip={t.closeTip}
            size="sm"
            onClick={end}
            data-testid="replay-close"
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={replay.position}
        aria-label={t.stepOf(replay.position, total)}
      >
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: total === 0 ? '100%' : `${(replay.position / total) * 100}%` }}
        />
      </div>
      {message ? (
        <p
          className={`m-0 text-[11px] leading-snug ${
            replay.status === 'diverged' || replay.reached === false ? 'text-danger' : 'text-ok'
          }`}
          role="status"
          data-testid="replay-status"
          data-reached={replay.reached === null ? undefined : String(replay.reached)}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
