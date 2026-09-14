import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack } from 'lucide-react';
import { displaySpeed, formatDistance, speedLabel } from '../lib/format';
import {
  MAX_SPEED_KMH,
  MAX_STEP_METERS,
  MIN_STEP_METERS,
  useSimulationStore,
} from '../store/simulationStore';

const STEP_BUTTON_CLASS =
  'flex min-h-[56px] flex-1 items-center justify-center gap-1 rounded-2xl bg-slate-800 text-slate-100 ' +
  'ring-1 ring-slate-700 transition active:scale-95 active:bg-slate-700 disabled:opacity-40 disabled:active:scale-100';

export function ControlPanel() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const step = useSimulationStore((state) => state.step);
  const togglePlay = useSimulationStore((state) => state.togglePlay);
  const resetToStart = useSimulationStore((state) => state.resetToStart);
  const setStepSize = useSimulationStore((state) => state.setStepSize);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const setSpeedUnit = useSimulationStore((state) => state.setSpeedUnit);

  const stepLabel = formatDistance(config.stepSizeMeters);
  const unitSuffix = speedLabel(config.speedUnit);

  return (
    <section
      className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/95 px-4 pt-3 backdrop-blur"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={() => step(-1)}
          disabled={!hasRoute}
          aria-label={`Step back ${stepLabel}`}
        >
          <ChevronsLeft size={20} />
          <span className="text-sm font-medium">-{stepLabel}</span>
        </button>

        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasRoute}
          className="flex min-h-[56px] min-w-[80px] items-center justify-center rounded-2xl bg-sky-500 text-slate-950 transition active:scale-95 active:bg-sky-400 disabled:opacity-40 disabled:active:scale-100"
          aria-label={config.isPlaying ? 'Pause simulation' : 'Play simulation'}
        >
          {config.isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>

        <button
          type="button"
          className={STEP_BUTTON_CLASS}
          onClick={() => step(1)}
          disabled={!hasRoute}
          aria-label={`Step forward ${stepLabel}`}
        >
          <span className="text-sm font-medium">+{stepLabel}</span>
          <ChevronsRight size={20} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-400" htmlFor="step-size">
          Step
          <input
            id="step-size"
            type="number"
            inputMode="numeric"
            min={MIN_STEP_METERS}
            max={MAX_STEP_METERS}
            step={10}
            value={config.stepSizeMeters}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) setStepSize(parsed);
            }}
            className="min-h-[44px] w-24 rounded-xl bg-slate-800 px-3 text-center font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          m
        </label>

        <button
          type="button"
          onClick={resetToStart}
          disabled={!hasRoute}
          className="ml-auto flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-800 px-3 text-sm text-slate-100 ring-1 ring-slate-700 transition active:scale-95 disabled:opacity-40"
        >
          <SkipBack size={16} /> Reset
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Speed</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-100">
              {Math.round(displaySpeed(config.speedKmh, config.speedUnit))} {unitSuffix}
            </span>
            <button
              type="button"
              onClick={() => setSpeedUnit(config.speedUnit === 'kmh' ? 'mph' : 'kmh')}
              className="min-h-[32px] rounded-lg bg-slate-800 px-2 text-[11px] uppercase tracking-wide text-slate-300 ring-1 ring-slate-700 active:scale-95"
            >
              {config.speedUnit === 'kmh' ? 'to mph' : 'to km/h'}
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={MAX_SPEED_KMH}
          step={1}
          value={config.speedKmh}
          onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label="Simulation speed"
          className="h-11 w-full accent-sky-500"
        />
      </div>
    </section>
  );
}
