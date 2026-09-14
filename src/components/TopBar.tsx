import { History, ListOrdered, Loader2, Repeat, Settings, Undo2 } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_BUTTON, GLASS_SURFACE } from './ui';

const BUTTON_CLASS = `${GLASS_BUTTON} min-h-[48px] min-w-[48px] gap-1 px-2.5`;

/**
 * Floating action buttons over the map. The status line appears only when it has
 * something to say, so it does not permanently occupy a strip of the map.
 */
export function TopBar() {
  const openHistory = useSimulationStore((state) => state.openHistory);
  const openSettings = useSimulationStore((state) => state.openSettings);
  const reverseRoute = useSimulationStore((state) => state.reverseRoute);
  const undo = useSimulationStore((state) => state.undo);
  const canUndo = useSimulationStore((state) => state.undoStack.length > 0);
  const openPlan = useSimulationStore((state) => state.openPlan);
  const isPlanOpen = useSimulationStore((state) => state.isPlanOpen);
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);

  const status = isRouting
    ? 'Calculating route'
    : isDrawArmed
      ? 'Draw a line across the map'
      : pointCount === 0
        ? 'Tap the map to set a start point'
        : null;

  return (
    <>
      <header className="flex w-full items-center gap-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => openHistory(true)}
          aria-label="Route history"
        >
          <History size={20} />
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => openSettings(true)}
          aria-label="Token and settings"
        >
          <Settings size={20} />
        </button>

        <div className="flex-1" />

        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={undo}
          disabled={!canUndo || isRouting}
          aria-label="Undo last route change"
        >
          <Undo2 size={20} />
        </button>
        <button
          type="button"
          className={`${BUTTON_CLASS} ${isPlanOpen ? 'text-sky-300 ring-sky-500' : ''}`}
          onClick={() => openPlan(!isPlanOpen)}
          aria-label={isPlanOpen ? 'Hide stops' : 'Show stops'}
          aria-pressed={isPlanOpen}
        >
          <ListOrdered size={20} />
          {pointCount > 0 && <span className="text-xs font-medium">{pointCount}</span>}
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

      {status && (
        <p
          className={`pointer-events-none flex w-fit items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs ${
            isRouting ? 'text-sky-300' : 'text-slate-400'
          } ${GLASS_SURFACE}`}
        >
          {isRouting && <Loader2 size={13} className="animate-spin" />}
          {status}
        </p>
      )}
    </>
  );
}
