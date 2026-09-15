import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack } from 'lucide-react';
import { displaySpeed, formatDistance, speedLabel } from '../lib/format';
import { MAX_SPEED_KMH, useSimulationStore } from '../store/simulationStore';
import { RecenterButton } from './RecenterButton';
import { DRIVE_TARGET, GLASS_BUTTON, GLASS_SURFACE, NORMAL_TARGET } from './ui';

/**
 * Every playback control floats over the map: two thumb columns and a speed slider,
 * both using the same glass surface as the other map overlays. Locking the route
 * switches to the Drive layout (D-1) - larger targets, and the planning-only reset
 * drops away - so the cluster grows only while it is actually being driven. The lock
 * itself lives in the top action row, out of reach of a thumb resting on playback.
 */
export function ControlPanel() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const step = useSimulationStore((state) => state.step);
  const togglePlay = useSimulationStore((state) => state.togglePlay);
  const resetToStart = useSimulationStore((state) => state.resetToStart);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const setSpeedUnit = useSimulationStore((state) => state.setSpeedUnit);
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);

  const backLabel = formatDistance(config.stepBackMeters);
  const forwardLabel = formatDistance(config.stepForwardMeters);

  const target = isRouteLocked ? DRIVE_TARGET : NORMAL_TARGET;
  const stepButtonClass = `${GLASS_BUTTON} ${target} flex-col gap-0.5 px-2`;
  const iconSize = isRouteLocked ? 26 : 22;

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-0 flex flex-col gap-2.5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`relative flex items-end justify-between gap-2 ${
          config.controlsMirrored ? 'flex-row-reverse' : ''
        }`}
      >
        {/* Out of flow on purpose: the thumb columns leave the middle of this row
            empty, so Recenter can appear and disappear there without shifting the
            play button under the thumb that is reaching for it. */}
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 justify-center">
          <RecenterButton />
        </div>

        {/* Playback in one column, stepping in the other, so neither thumb crosses the map. */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!hasRoute}
            aria-label={config.isPlaying ? 'Pause simulation' : 'Play simulation'}
            className={`pointer-events-auto flex ${target} items-center justify-center rounded-full bg-sky-500 text-slate-950 shadow-lg shadow-sky-950/50 ring-1 ring-sky-400 transition active:scale-95 active:bg-sky-400 disabled:opacity-40 disabled:active:scale-100`}
          >
            {config.isPlaying ? (
              <Pause size={iconSize + 4} fill="currentColor" />
            ) : (
              <Play size={iconSize + 4} fill="currentColor" />
            )}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={stepButtonClass}
            onClick={() => step(1)}
            disabled={!hasRoute}
            aria-label={`Step forward ${forwardLabel}`}
          >
            <ChevronsRight size={iconSize} />
            <span className="font-mono text-[11px] leading-none">{forwardLabel}</span>
          </button>

          <button
            type="button"
            className={stepButtonClass}
            onClick={() => step(-1)}
            disabled={!hasRoute}
            aria-label={`Step back ${backLabel}`}
          >
            <ChevronsLeft size={iconSize} />
            <span className="font-mono text-[11px] leading-none">{backLabel}</span>
          </button>
        </div>
      </div>

      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-3 py-1.5 ${GLASS_SURFACE}`}
      >
        {/* Returning to the start is a planning action, so the Drive layout drops it. */}
        {!isRouteLocked && (
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-100 transition active:scale-95 active:bg-slate-800 disabled:opacity-40 disabled:active:scale-100"
            onClick={resetToStart}
            disabled={!hasRoute}
            aria-label="Reset to start"
          >
            <SkipBack size={18} />
          </button>
        )}

        <input
          type="range"
          min={0}
          max={MAX_SPEED_KMH}
          step={1}
          value={config.speedKmh}
          onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label="Simulation speed"
          className="h-10 flex-1 accent-sky-500"
        />
        <span className="w-14 shrink-0 text-right font-mono text-base text-slate-100">
          {Math.round(displaySpeed(config.speedKmh, config.speedUnit))}
        </span>
        <button
          type="button"
          onClick={() => setSpeedUnit(config.speedUnit === 'kmh' ? 'mph' : 'kmh')}
          aria-label={`Switch to ${config.speedUnit === 'kmh' ? 'mph' : 'km/h'}`}
          className="min-h-[36px] shrink-0 rounded-lg bg-slate-800 px-2 text-[11px] uppercase tracking-wide text-slate-300 ring-1 ring-slate-700 active:scale-95"
        >
          {speedLabel(config.speedUnit)}
        </button>
      </div>
    </div>
  );
}
