import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { formatDistance } from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';

const BUTTON_CLASS =
  'pointer-events-auto flex min-h-[56px] min-w-[56px] flex-col items-center justify-center gap-0.5 ' +
  'rounded-2xl bg-slate-900/85 px-3 text-slate-100 shadow-lg shadow-slate-950/50 ring-1 ring-slate-700 ' +
  'backdrop-blur transition active:scale-95 active:bg-slate-800 disabled:opacity-40 disabled:active:scale-100';

/**
 * Step controls float over the map rather than sitting in the bottom panel, so the
 * map keeps as much of the viewport as possible. Distances are configured in Settings.
 */
export function StepButtons() {
  const stepForwardMeters = useSimulationStore((state) => state.config.stepForwardMeters);
  const stepBackMeters = useSimulationStore((state) => state.config.stepBackMeters);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const step = useSimulationStore((state) => state.step);

  const backLabel = formatDistance(stepBackMeters);
  const forwardLabel = formatDistance(stepForwardMeters);

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-4 flex items-end justify-between">
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => step(-1)}
        disabled={!hasRoute}
        aria-label={`Step back ${backLabel}`}
      >
        <ChevronsLeft size={20} />
        <span className="font-mono text-[11px] leading-none">{backLabel}</span>
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => step(1)}
        disabled={!hasRoute}
        aria-label={`Step forward ${forwardLabel}`}
      >
        <ChevronsRight size={20} />
        <span className="font-mono text-[11px] leading-none">{forwardLabel}</span>
      </button>
    </div>
  );
}
