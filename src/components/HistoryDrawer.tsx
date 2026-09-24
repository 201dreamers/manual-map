import { Trash2, X } from 'lucide-react';
import { formatDistance, formatTimestamp } from '../lib/format';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_PANEL, Z_HISTORY } from './ui';

export function HistoryDrawer() {
  const isOpen = useSimulationStore((state) => state.isHistoryOpen);
  const unitSystem = useSimulationStore((state) => state.config.unitSystem);
  const savedRoutes = useSimulationStore((state) => state.savedRoutes);
  const activeRouteId = useSimulationStore((state) => state.activeRoute?.id ?? null);
  const openHistory = useSimulationStore((state) => state.openHistory);
  const controlsMirrored = useSimulationStore((state) => state.config.controlsMirrored);
  const loadSavedRoute = useSimulationStore((state) => state.loadSavedRoute);
  const deleteSavedRoute = useSimulationStore((state) => state.deleteSavedRoute);
  const clearSavedRoutes = useSimulationStore((state) => state.clearSavedRoutes);

  if (!isOpen) return null;

  return (
    <div
      className={`pointer-events-auto absolute inset-0 ${Z_HISTORY} flex ${
        controlsMirrored ? 'justify-end' : ''
      }`}
    >
      <button
        type="button"
        aria-label="Close route history"
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={() => openHistory(false)}
      />

      <aside
        className={`relative flex h-full w-[86%] max-w-sm flex-col ${GLASS_PANEL}`}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">Saved routes</h2>
          <button
            type="button"
            onClick={() => openHistory(false)}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 active:scale-95 active:bg-slate-800"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {savedRoutes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              No routes saved yet. Build a route on the map and it is stored here automatically.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {savedRoutes.map((route) => (
                <li key={route.id} className="flex items-stretch gap-2 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => loadSavedRoute(route.id)}
                    className={`flex min-h-[56px] flex-1 flex-col justify-center rounded-xl px-2 text-left transition active:scale-[0.99] active:bg-slate-800 ${
                      route.id === activeRouteId ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <span className="truncate font-mono text-xs text-slate-200">{route.title}</span>
                    <span className="text-[11px] text-slate-500">
                      {formatDistance(route.totalDistanceMeters, unitSystem)} · {formatTimestamp(route.createdAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSavedRoute(route.id)}
                    aria-label={`Delete route ${route.title}`}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 active:scale-95 active:bg-slate-800 active:text-red-400"
                  >
                    <Trash2 size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {savedRoutes.length > 0 && (
          <footer className="border-t border-slate-800 p-3">
            <button
              type="button"
              onClick={clearSavedRoutes}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 text-sm font-medium text-red-300 ring-1 ring-red-500/30 active:scale-95"
            >
              <Trash2 size={16} /> Clear all history
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
