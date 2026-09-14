import { History, Loader2, Repeat, RotateCcw, Settings, Undo2 } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';

const BUTTON_CLASS =
  'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-slate-800/80 px-3 text-slate-100 ' +
  'ring-1 ring-slate-700 transition active:scale-95 active:bg-slate-700 disabled:opacity-40 disabled:active:scale-100';

export function TopBar() {
  const openHistory = useSimulationStore((state) => state.openHistory);
  const openSettings = useSimulationStore((state) => state.openSettings);
  const reverseRoute = useSimulationStore((state) => state.reverseRoute);
  const undoLastPoint = useSimulationStore((state) => state.undoLastPoint);
  const clearRoute = useSimulationStore((state) => state.clearRoute);
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const isRouting = useSimulationStore((state) => state.isRouting);

  return (
    <header
      className="pointer-events-auto flex items-center gap-2 bg-slate-950/85 px-3 pb-2 backdrop-blur"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <button type="button" className={BUTTON_CLASS} onClick={() => openHistory(true)} aria-label="Route history">
        <History size={20} />
      </button>
      <button type="button" className={BUTTON_CLASS} onClick={() => openSettings(true)} aria-label="Token and settings">
        <Settings size={20} />
      </button>

      <div className="flex-1 text-center text-xs text-slate-400">
        {isRouting ? (
          <span className="inline-flex items-center gap-1.5 text-sky-300">
            <Loader2 size={14} className="animate-spin" /> Calculating route
          </span>
        ) : (
          <span>{pointCount === 0 ? 'Tap the map to set a start point' : `${pointCount} point${pointCount === 1 ? '' : 's'}`}</span>
        )}
      </div>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => void undoLastPoint()}
        disabled={pointCount === 0 || isRouting}
        aria-label="Undo last point"
      >
        <Undo2 size={20} />
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={clearRoute}
        disabled={pointCount === 0}
        aria-label="Clear route"
      >
        <RotateCcw size={20} />
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => void reverseRoute()}
        disabled={pointCount < 2 || isRouting}
        aria-label="Reverse route"
      >
        <Repeat size={20} />
      </button>
    </header>
  );
}
