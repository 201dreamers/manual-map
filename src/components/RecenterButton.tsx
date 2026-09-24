import { LocateFixed } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

/**
 * FR-4.3: shown only once the user has taken manual control of the camera. The control
 * panel floats it in the empty middle of the button row, level with the play button and
 * directly above the speed row, so appearing costs no layout shift.
 */
export function RecenterButton() {
  const cameraTrackingEnabled = useSimulationStore((state) => state.config.cameraTrackingEnabled);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const setCameraTracking = useSimulationStore((state) => state.setCameraTracking);

  if (cameraTrackingEnabled || !hasRoute) return null;

  return (
    <button
      type="button"
      onClick={() => setCameraTracking(true)}
      className={`pointer-events-auto flex min-h-[56px] items-center gap-2 rounded-full px-5 text-base font-medium text-sky-200 ${GLASS_SURFACE}`}
    >
      <LocateFixed size={20} /> Recenter
    </button>
  );
}
