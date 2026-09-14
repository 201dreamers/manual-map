import { Compass } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

/** Sits directly above the pen button in the left-hand stack. */
const BOTTOM_OFFSET = 'calc(13rem + env(safe-area-inset-bottom))';

/** Rotates the map back to north-up, leaving the camera where it is. */
export function CompassButton() {
  const hasToken = useSimulationStore((state) => state.mapboxToken !== null);
  const resetNorth = useSimulationStore((state) => state.resetNorth);

  if (!hasToken) return null;

  return (
    <button
      type="button"
      onClick={resetNorth}
      aria-label="Face the map north"
      style={{ bottom: BOTTOM_OFFSET }}
      className={`pointer-events-auto absolute left-3 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl text-slate-100 transition active:scale-95 ${GLASS_SURFACE}`}
    >
      <Compass size={20} />
    </button>
  );
}
