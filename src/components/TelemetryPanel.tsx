import type { ReactNode } from 'react';
import {
  displaySpeed,
  formatCoordinate,
  formatDistanceKm,
  formatEta,
  speedLabel,
} from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_SURFACE } from './ui';

function Card({ children }: { children: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${GLASS_SURFACE}`}>{children}</div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase leading-none tracking-wide text-slate-500">{label}</p>
      <p className="truncate font-mono text-sm leading-tight text-slate-100">{value}</p>
    </div>
  );
}

/**
 * Telemetry is split into small independent cards that wrap to the next line on
 * narrow screens, leaving as much of the map visible between them as possible.
 */
export function TelemetryPanel() {
  const telemetry = useSimulationStore((state) => state.displayTelemetry);
  const unit = useSimulationStore((state) => state.config.speedUnit);
  const totalDistanceMeters = useSimulationStore(
    (state) => state.activeRoute?.totalDistanceMeters ?? 0,
  );

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start gap-2">
      <Card>
        <p className="font-mono text-2xl leading-none text-slate-100">
          {Math.round(displaySpeed(telemetry.currentSpeedKmh, unit))}
        </p>
        <p className="text-[10px] uppercase leading-none tracking-wide text-slate-500">
          {speedLabel(unit)}
        </p>
      </Card>

      <Card>
        <Metric label="Remaining" value={`${formatDistanceKm(telemetry.remainingDistanceMeters)} km`} />
        <Metric label="ETA" value={formatEta(telemetry.etaSeconds)} />
      </Card>

      <Card>
        <Metric
          label="Distance"
          value={`${formatDistanceKm(telemetry.currentDistanceMeters)}/${formatDistanceKm(totalDistanceMeters)} km`}
        />
        <Metric label="Position" value={formatCoordinate(telemetry.currentCoordinate)} />
      </Card>
    </div>
  );
}
