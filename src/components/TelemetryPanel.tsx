import { formatDistanceKm, formatEta } from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase leading-none tracking-wide text-slate-500">{label}</p>
      <p className="truncate font-mono text-sm leading-tight text-slate-100">{value}</p>
    </div>
  );
}

/**
 * Progress along the route and the arrival estimate. Current speed lives on the
 * speed slider, and the live coordinate is shown by the marker itself.
 */
export function TelemetryPanel() {
  const telemetry = useSimulationStore((state) => state.displayTelemetry);
  const totalDistanceMeters = useSimulationStore(
    (state) => state.activeRoute?.totalDistanceMeters ?? 0,
  );

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className={`flex items-center gap-4 rounded-2xl px-3 py-2 ${GLASS_SURFACE}`}>
        <Metric
          label="Distance"
          value={`${formatDistanceKm(telemetry.currentDistanceMeters)}/${formatDistanceKm(totalDistanceMeters)} km`}
        />
        <Metric label="ETA" value={formatEta(telemetry.etaSeconds)} />
      </div>
    </div>
  );
}
