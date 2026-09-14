import { ListOrdered, Loader2 } from 'lucide-react';
import { MenuButton } from './MenuButton';
import { TelemetryPanel } from './TelemetryPanel';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_BUTTON, GLASS_SURFACE } from './ui';

const BUTTON_CLASS = `${GLASS_BUTTON} min-h-[48px] min-w-[48px] gap-1 px-2.5`;

/**
 * Top overlay row: the menu on the left, telemetry in the middle and the stop list
 * on the right. The status line appears only when it has something to say, so it
 * does not permanently occupy a strip of the map.
 */
export function TopBar() {
  const openPlan = useSimulationStore((state) => state.openPlan);
  const isPlanOpen = useSimulationStore((state) => state.isPlanOpen);
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);

  const status = isRouting
    ? 'Calculating route'
    : isDrawArmed
      ? 'Draw a line across the map'
      : pointCount === 0
        ? 'Tap the map to set a start point'
        : null;

  return (
    <>
      <header className="flex w-full items-start justify-between gap-2">
        <MenuButton />

        {/* Centred telemetry; min-w-0 lets it shrink instead of pushing the buttons out. */}
        <div className="flex min-w-0 flex-1 justify-center">
          <TelemetryPanel />
        </div>

        <button
          type="button"
          className={`${BUTTON_CLASS} ${isPlanOpen ? 'text-sky-300 ring-sky-500' : ''}`}
          onClick={() => openPlan(!isPlanOpen)}
          aria-label={isPlanOpen ? 'Hide stops' : 'Show stops'}
          aria-pressed={isPlanOpen}
        >
          <ListOrdered size={20} />
          {pointCount > 0 && <span className="text-xs font-medium">{pointCount}</span>}
        </button>
      </header>

      {status && (
        <p
          className={`pointer-events-none mx-auto flex w-fit items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs ${
            isRouting ? 'text-sky-300' : 'text-slate-400'
          } ${GLASS_SURFACE}`}
        >
          {isRouting && <Loader2 size={13} className="animate-spin" />}
          {status}
        </p>
      )}
    </>
  );
}
