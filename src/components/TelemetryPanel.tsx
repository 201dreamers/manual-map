import {
  displaySpeed,
  formatCoordinate,
  formatDistanceKm,
  formatEta,
  speedLabel,
} from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="truncate font-mono text-sm text-slate-100">{value}</p>
    </div>
  );
}

export function TelemetryPanel() {
  const telemetry = useSimulationStore((state) => state.displayTelemetry);
  const unit = useSimulationStore((state) => state.config.speedUnit);
  const totalDistanceMeters = useSimulationStore(
    (state) => state.activeRoute?.totalDistanceMeters ?? 0,
  );

  return (
    <section className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
      <Metric
        label="Speed"
        value={`${Math.round(displaySpeed(telemetry.currentSpeedKmh, unit))} ${speedLabel(unit)}`}
      />
      <Metric
        label="Distance"
        value={`${formatDistanceKm(telemetry.currentDistanceMeters)} / ${formatDistanceKm(totalDistanceMeters)} km`}
      />
      <Metric label="ETA" value={formatEta(telemetry.etaSeconds)} />
      <Metric label="Remaining" value={`${formatDistanceKm(telemetry.remainingDistanceMeters)} km`} />
      <div className="col-span-2">
        <Metric label="Position" value={formatCoordinate(telemetry.currentCoordinate)} />
      </div>
    </section>
  );
}
