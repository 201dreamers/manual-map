import { LocateFixed } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';

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
      className="pointer-events-auto absolute bottom-4 left-1/2 flex min-h-[44px] -translate-x-1/2 items-center gap-2 rounded-full bg-sky-500 px-4 text-sm font-medium text-slate-950 shadow-lg shadow-sky-900/40 transition active:scale-95"
    >
      <LocateFixed size={18} /> Recenter
    </button>
  );
}
