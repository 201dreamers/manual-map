import { LocateFixed } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

/** Clears the floating control cluster stacked below it. */
const BOTTOM_OFFSET = 'calc(9.5rem + env(safe-area-inset-bottom))';

/** FR-4.3: shown only once the user has taken manual control of the camera. */
export function RecenterButton() {
  const cameraTrackingEnabled = useSimulationStore((state) => state.config.cameraTrackingEnabled);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const setCameraTracking = useSimulationStore((state) => state.setCameraTracking);

  if (cameraTrackingEnabled || !hasRoute) return null;

  return (
    <button
      type="button"
      onClick={() => setCameraTracking(true)}
      style={{ bottom: BOTTOM_OFFSET }}
      className={`pointer-events-auto absolute left-1/2 flex min-h-[44px] -translate-x-1/2 items-center gap-2 rounded-full px-4 text-sm font-medium text-sky-200 ${GLASS_SURFACE}`}
    >
      <LocateFixed size={18} /> Recenter
    </button>
  );
}
