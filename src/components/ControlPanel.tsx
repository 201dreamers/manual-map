import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack } from 'lucide-react';
import { displaySpeed, formatDistance, speedLabel } from '../lib/format';
import { MAX_SPEED_KMH, useSimulationStore } from '../store/simulationStore';
import { GLASS_BUTTON, GLASS_SURFACE } from './ui';

const STEP_BUTTON_CLASS = `${GLASS_BUTTON} min-h-[56px] min-w-[56px] flex-col gap-0.5 px-3`;

/**
 * Every playback control floats over the map: a step/play row and a speed slider,
 * both using the same glass surface as the other map overlays.
 */
export function ControlPanel() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const step = useSimulationStore((state) => state.step);
  const togglePlay = useSimulationStore((state) => state.togglePlay);
  const resetToStart = useSimulationStore((state) => state.resetToStart);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const setSpeedUnit = useSimulationStore((state) => state.setSpeedUnit);

  const backLabel = formatDistance(config.stepBackMeters);
  const forwardLabel = formatDistance(config.stepForwardMeters);

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-0 flex flex-col gap-2.5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={() => step(-1)}
          disabled={!hasRoute}
          aria-label={`Step back ${backLabel}`}
        >
          <ChevronsLeft size={20} />
          <span className="font-mono text-[11px] leading-none">{backLabel}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${GLASS_BUTTON} min-h-[44px] min-w-[44px]`}
            onClick={resetToStart}
            disabled={!hasRoute}
            aria-label="Reset to start"
          >
            <SkipBack size={18} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={!hasRoute}
            aria-label={config.isPlaying ? 'Pause simulation' : 'Play simulation'}
            className="pointer-events-auto flex min-h-[60px] min-w-[60px] items-center justify-center rounded-full bg-sky-500 text-slate-950 shadow-lg shadow-sky-950/50 ring-1 ring-sky-400 transition active:scale-95 active:bg-sky-400 disabled:opacity-40 disabled:active:scale-100"
          >
            {config.isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
          </button>
        </div>

        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={() => step(1)}
          disabled={!hasRoute}
          aria-label={`Step forward ${forwardLabel}`}
        >
          <ChevronsRight size={20} />
          <span className="font-mono text-[11px] leading-none">{forwardLabel}</span>
        </button>
      </div>

      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-3 py-1.5 ${GLASS_SURFACE}`}
      >
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
        <span className="w-16 shrink-0 text-right font-mono text-sm text-slate-100">
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
