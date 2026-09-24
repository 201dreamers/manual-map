import { ListOrdered } from 'lucide-react';
import { distanceMajorLabel, formatDistanceMajor } from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-left">
      <p className="text-[10px] uppercase leading-none tracking-wide text-slate-300">{label}</p>
      <p className="truncate font-mono text-sm leading-tight text-slate-100">{value}</p>
    </div>
  );
}

/**
 * Progress along the route, and the way into the stop list.
 *
 * The two were separate controls competing for the same crowded row. Folding them
 * together costs nothing, because the number and the list describe the same thing: a
 * tap on "1.5/2.0 km" asking to see which stops those are is the obvious gesture, and
 * it frees the slot the list button was holding.
 *
 * Current speed lives on the dial, the live coordinate is shown by the marker, and the
 * arrival estimate is gone - it was the widest thing in a panel that has to share a row
 * with three buttons, and it is derived from a speed the driver is choosing anyway.
 */
export function TelemetryPanel() {
  const telemetry = useSimulationStore((state) => state.displayTelemetry);
  const unitSystem = useSimulationStore((state) => state.config.unitSystem);
  const isPlanOpen = useSimulationStore((state) => state.isPlanOpen);
  const openPlan = useSimulationStore((state) => state.openPlan);
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const totalDistanceMeters = useSimulationStore(
    (state) => state.activeRoute?.totalDistanceMeters ?? 0,
  );

  return (
    <button
      type="button"
      onClick={() => openPlan(!isPlanOpen)}
      aria-label={isPlanOpen ? 'Hide stops' : 'Show stops'}
      aria-pressed={isPlanOpen}
      className={`pointer-events-auto flex items-center gap-4 rounded-2xl px-3 py-2 transition active:scale-[0.98] ${GLASS_SURFACE} ${
        isPlanOpen ? 'ring-sky-500' : ''
      }`}
    >
      <Metric
        label="Distance"
        value={`${formatDistanceMajor(telemetry.currentDistanceMeters, unitSystem)}/${formatDistanceMajor(totalDistanceMeters, unitSystem)} ${distanceMajorLabel(unitSystem)}`}
      />
      {/* The count that used to sit on the separate list button. */}
      <span
        className={`flex shrink-0 items-center gap-1 border-l border-white/10 pl-3 text-xs ${
          isPlanOpen ? 'text-sky-300' : 'text-slate-300'
        }`}
      >
        <ListOrdered size={16} />
        {pointCount > 0 && <span className="font-medium">{pointCount}</span>}
      </span>
    </button>
  );
}
