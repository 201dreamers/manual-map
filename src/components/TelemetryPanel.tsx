import {
  displaySpeed,
  formatCoordinate,
  formatDistanceKm,
  formatEta,
  speedLabel,
} from '../lib/format';
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

/** Floating telemetry readout; sits over the map so the map keeps the full viewport. */
export function TelemetryPanel() {
  const telemetry = useSimulationStore((state) => state.displayTelemetry);
  const unit = useSimulationStore((state) => state.config.speedUnit);
  const totalDistanceMeters = useSimulationStore(
    (state) => state.activeRoute?.totalDistanceMeters ?? 0,
  );

  return (
    <section
      className={`pointer-events-none absolute inset-x-3 top-3 grid grid-cols-3 gap-x-3 gap-y-2 rounded-2xl px-3 py-2.5 ${GLASS_SURFACE}`}
    >
      <Metric
        label="Speed"
        value={`${Math.round(displaySpeed(telemetry.currentSpeedKmh, unit))} ${speedLabel(unit)}`}
      />
      <Metric
        label="Distance"
        value={`${formatDistanceKm(telemetry.currentDistanceMeters)}/${formatDistanceKm(totalDistanceMeters)}`}
      />
      <Metric label="ETA" value={formatEta(telemetry.etaSeconds)} />
      <Metric label="Remaining" value={`${formatDistanceKm(telemetry.remainingDistanceMeters)} km`} />
      <div className="col-span-2">
        <Metric label="Position" value={formatCoordinate(telemetry.currentCoordinate)} />
      </div>
    </section>
  );
}
