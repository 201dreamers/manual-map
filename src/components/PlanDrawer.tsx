import { ChevronDown, ChevronUp, MapPin, Trash2, X } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import type { RoutePoint } from '../types/domain';
import { SearchPanel } from './SearchPanel';
import { GLASS_SURFACE } from './ui';

/** Clears the floating control cluster so playback stays reachable (AC-203). */
const BOTTOM_OFFSET = 'calc(12.5rem + env(safe-area-inset-bottom))';
/** Clears the floating button row at the top of the map. */
const TOP_OFFSET = 'calc(4.5rem + env(safe-area-inset-top))';

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 ' +
  'transition active:scale-95 active:bg-slate-800 disabled:opacity-25 disabled:active:scale-100';

function roleOf(index: number, total: number): string {
  if (index === 0) return 'Start';
  if (index === total - 1) return 'End';
  return `Via ${index}`;
}

/** A-3: only searched stops carry a real name; tapped pins show their coordinates. */
function describe(point: RoutePoint): string {
  if (point.label) return point.label;
  const [lng, lat] = point.coordinate;
  return `Dropped pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}

export function PlanDrawer() {
  const isOpen = useSimulationStore((state) => state.isPlanOpen);
  const routePoints = useSimulationStore((state) => state.routePoints);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const openPlan = useSimulationStore((state) => state.openPlan);
  const moveRoutePoint = useSimulationStore((state) => state.moveRoutePoint);
  const removeRoutePoint = useSimulationStore((state) => state.removeRoutePoint);
  const clearRoute = useSimulationStore((state) => state.clearRoute);

  if (!isOpen) return null;

  const total = routePoints.length;

  return (
    <aside
      style={{ bottom: BOTTOM_OFFSET, top: TOP_OFFSET }}
      className={`pointer-events-auto absolute right-3 flex w-[min(20rem,78vw)] flex-col overflow-hidden rounded-2xl ${GLASS_SURFACE}`}
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <h2 className="text-sm font-medium text-slate-100">
          Stops{total > 0 && <span className="ml-1.5 text-slate-500">{total}</span>}
        </h2>
        <button
          type="button"
          onClick={() => openPlan(false)}
          aria-label="Close stops"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 active:scale-95 active:bg-slate-800"
        >
          <X size={18} />
        </button>
      </header>

      <SearchPanel />

      <div className="flex-1 overflow-y-auto">
        {total === 0 ? (
          <p className="flex items-center gap-2 px-3 py-4 text-xs leading-relaxed text-slate-500">
            <MapPin size={16} className="shrink-0" />
            Tap the map to add your first stop.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {routePoints.map((point, index) => (
              <li key={point.id} className="flex items-center gap-1 px-2 py-1">
                <div className="min-w-0 flex-1 px-1">
                  <p className="text-[10px] uppercase leading-none tracking-wide text-slate-500">
                    {roleOf(index, total)}
                  </p>
                  <p className="truncate text-xs leading-tight text-slate-100">{describe(point)}</p>
                </div>

                <button
                  type="button"
                  className={ICON_BUTTON}
                  onClick={() => moveRoutePoint(point.id, -1)}
                  disabled={index === 0 || isRouting}
                  aria-label={`Move ${describe(point)} up`}
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  onClick={() => moveRoutePoint(point.id, 1)}
                  disabled={index === total - 1 || isRouting}
                  aria-label={`Move ${describe(point)} down`}
                >
                  <ChevronDown size={18} />
                </button>
                <button
                  type="button"
                  className={`${ICON_BUTTON} active:text-red-400`}
                  onClick={() => removeRoutePoint(point.id)}
                  disabled={isRouting}
                  aria-label={`Remove ${describe(point)}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <footer className="border-t border-slate-700 p-2">
          <button
            type="button"
            onClick={clearRoute}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 text-xs font-medium text-red-300 ring-1 ring-red-500/30 active:scale-95"
          >
            <Trash2 size={14} /> Clear route
          </button>
        </footer>
      )}
    </aside>
  );
}
