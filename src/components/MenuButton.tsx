import { useEffect, useRef } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  Compass,
  History,
  Menu,
  Pencil,
  RefreshCw,
  Settings,
  Stethoscope,
  Undo2,
} from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_BUTTON, GLASS_SURFACE } from './ui';

const ITEM_CLASS =
  'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-slate-100 ' +
  'transition active:scale-[0.98] active:bg-slate-800 disabled:opacity-40 disabled:active:scale-100';

/**
 * Collapses the secondary actions into one top-left button so the map keeps its
 * space. Each entry closes the menu, because every one of them either opens a
 * panel or changes the route.
 */
export function MenuButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = useSimulationStore((state) => state.isMenuOpen);
  const setOpen = useSimulationStore((state) => state.openMenu);

  const openHistory = useSimulationStore((state) => state.openHistory);
  const openSettings = useSimulationStore((state) => state.openSettings);
  const undo = useSimulationStore((state) => state.undo);
  const canUndo = useSimulationStore((state) => state.undoStack.length > 0);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);
  const setDrawArmed = useSimulationStore((state) => state.setDrawArmed);
  const resetNorth = useSimulationStore((state) => state.resetNorth);
  const hasToken = useSimulationStore((state) => state.mapboxToken !== null);
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);
  const controlsMirrored = useSimulationStore((state) => state.config.controlsMirrored);
  const obdStatus = useSimulationStore((state) => state.obd.status);
  const trafficStatus = useSimulationStore((state) => state.traffic.status);
  const refreshIncidents = useSimulationStore((state) => state.refreshIncidents);
  const isLoadingCameras = useSimulationStore((state) => state.traffic.isLoadingCameras);
  const refreshCameras = useSimulationStore((state) => state.refreshCameras);
  // Either half in flight spins the icon: to the driver it is one refresh.
  const isRefreshing = trafficStatus === 'loading' || isLoadingCameras;
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const connectObd = useSimulationStore((state) => state.connectObd);
  const disconnectObd = useSimulationStore((state) => state.disconnectObd);
  const runObdProbes = useSimulationStore((state) => state.runObdProbes);
  const pushToast = useSimulationStore((state) => state.pushToast);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture, so a tap that lands on the map closes the menu before the map handles it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // `setOpen` is the store's action and never changes identity; it is listed so the
    // dependency list stays honest rather than relying on that.
  }, [isOpen, setOpen]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`${GLASS_BUTTON} min-h-[48px] min-w-[48px] rounded-2xl ${
          isDrawArmed ? 'text-amber-300 ring-amber-400' : ''
        }`}
        onClick={() => setOpen(!isOpen)}
        aria-label="Menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Menu size={20} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`pointer-events-auto absolute ${
            controlsMirrored ? 'right-0' : 'left-0'
          } top-[calc(100%+0.5rem)] z-20 flex w-52 flex-col gap-0.5 rounded-2xl p-1.5 ${GLASS_SURFACE}`}
        >
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(() => openSettings(true))}>
            <Settings size={18} /> Settings
          </button>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(() => openHistory(true))}>
            <History size={18} /> History
          </button>
          {/*
            D-24: with no Web Bluetooth the status is `unavailable` and nothing renders
            here at all, so the Safari PWA tree is unchanged. The item stays enabled
            while locked - connecting an adapter is not a route edit.
          */}
          {obdStatus !== 'unavailable' && (
            <button
              type="button"
              role="menuitem"
              className={ITEM_CLASS}
              disabled={obdStatus === 'connecting'}
              onClick={run(() => {
                void (obdStatus === 'connected' ? disconnectObd() : connectObd());
              })}
            >
              {obdStatus === 'connected' ? (
                <BluetoothConnected size={18} className="text-emerald-400" />
              ) : (
                <Bluetooth size={18} />
              )}
              {obdStatus === 'connected'
                ? 'Disconnect OBD'
                : obdStatus === 'connecting'
                  ? 'Connecting...'
                  : 'Connect OBD'}
            </button>
          )}
          {/*
            Only while connected, because it has nothing to ask otherwise.

            It repeats the sweep that already ran at connect, which is worth a menu item
            because the answers are not constant: several distance PIDs read zero or
            refuse outright on a stationary car and only become informative once it is
            moving. Diagnosing this needs a driver, a laptop and a road, so the one
            thing the app can do is make the question cheap to re-ask.
          */}
          {obdStatus === 'connected' && (
            <button
              type="button"
              role="menuitem"
              className={ITEM_CLASS}
              onClick={run(() => {
                void runObdProbes();
                pushToast('info', 'Probing the car. Results are in the browser console.');
              })}
            >
              <Stethoscope size={18} /> Run OBD probes
            </button>
          )}
          {/*
            Always present, and it refreshes both layers rather than only incidents.
            Everything else fetches on its own schedule - incidents on the lock and then
            once a half hour, cameras once per route - so this is the one way to ask for
            fresh data on demand, and hiding it behind the state of one layer made it
            hard to find exactly when it was wanted.

            Each refresh is individually gated: with the incidents layer off, or no
            TomTom key, that half simply does nothing. Still disabled without a route,
            because both fetches are scoped to the route and there is nothing to ask for.
          */}
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            disabled={!hasRoute || isRefreshing}
            onClick={run(() => {
              void refreshIncidents(true);
              void refreshCameras(true);
            })}
          >
            <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh traffic'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            disabled={!canUndo || isRouting || isRouteLocked}
            onClick={run(undo)}
          >
            <Undo2 size={18} /> Undo
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${ITEM_CLASS} ${isDrawArmed ? 'text-amber-300' : ''}`}
            disabled={!hasToken || isRouteLocked}
            aria-pressed={isDrawArmed}
            onClick={run(() => setDrawArmed(!isDrawArmed))}
          >
            <Pencil size={18} /> {isDrawArmed ? 'Cancel drawing' : 'Draw line'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            disabled={!hasToken}
            onClick={run(resetNorth)}
          >
            <Compass size={18} /> Face north
          </button>
        </div>
      )}
    </div>
  );
}
