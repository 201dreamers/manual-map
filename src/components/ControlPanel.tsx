import { Pause, Play, SkipBack } from 'lucide-react';
import { displaySpeed, speedLabel } from '../lib/format';
import { MAX_SPEED_KMH, useSimulationStore } from '../store/simulationStore';

export function ControlPanel() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const togglePlay = useSimulationStore((state) => state.togglePlay);
  const resetToStart = useSimulationStore((state) => state.resetToStart);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const setSpeedUnit = useSimulationStore((state) => state.setSpeedUnit);

  const unitSuffix = speedLabel(config.speedUnit);

  return (
    <section
      className="flex flex-col gap-2.5 border-t border-slate-800 bg-slate-950/95 px-4 pt-3 backdrop-blur"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={resetToStart}
          disabled={!hasRoute}
          aria-label="Reset to start"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-slate-100 ring-1 ring-slate-700 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          <SkipBack size={18} />
        </button>

        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasRoute}
          className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl bg-sky-500 text-slate-950 transition active:scale-95 active:bg-sky-400 disabled:opacity-40 disabled:active:scale-100"
          aria-label={config.isPlaying ? 'Pause simulation' : 'Play simulation'}
        >
          {config.isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
        </button>

        <button
          type="button"
          onClick={() => setSpeedUnit(config.speedUnit === 'kmh' ? 'mph' : 'kmh')}
          className="flex min-h-[44px] min-w-[52px] items-center justify-center rounded-xl bg-slate-800 text-[11px] uppercase tracking-wide text-slate-300 ring-1 ring-slate-700 active:scale-95"
        >
          {config.speedUnit === 'kmh' ? 'mph' : 'km/h'}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={MAX_SPEED_KMH}
          step={1}
          value={config.speedKmh}
          onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label="Simulation speed"
          className="h-9 flex-1 accent-sky-500"
        />
        <span className="w-20 shrink-0 text-right font-mono text-sm text-slate-100">
          {Math.round(displaySpeed(config.speedKmh, config.speedUnit))} {unitSuffix}
        </span>
      </div>
    </section>
  );
}
