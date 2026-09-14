import { Pencil } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

/** Clears the floating control cluster stacked below it. */
const BOTTOM_OFFSET = 'calc(9.5rem + env(safe-area-inset-bottom))';

/**
 * Arms freehand drawing. Drawing needs an explicit mode because a drag is
 * otherwise a map pan; the pen disarms itself once a stroke completes.
 */
export function DrawButton() {
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);
  const hasToken = useSimulationStore((state) => state.mapboxToken !== null);
  const setDrawArmed = useSimulationStore((state) => state.setDrawArmed);

  if (!hasToken) return null;

  return (
    <button
      type="button"
      onClick={() => setDrawArmed(!isDrawArmed)}
      aria-label={isDrawArmed ? 'Cancel drawing' : 'Draw a line to reshape the route'}
      aria-pressed={isDrawArmed}
      style={{ bottom: BOTTOM_OFFSET }}
      className={
        isDrawArmed
          ? 'pointer-events-auto absolute left-3 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-900/40 transition active:scale-95'
          : `pointer-events-auto absolute left-3 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl text-slate-100 transition active:scale-95 ${GLASS_SURFACE}`
      }
    >
      <Pencil size={20} />
    </button>
  );
}
