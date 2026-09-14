import { useEffect, useRef, useState } from 'react';
import { Compass, History, Menu, Pencil, Repeat, Settings, Undo2 } from 'lucide-react';
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
  const [isOpen, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const openHistory = useSimulationStore((state) => state.openHistory);
  const openSettings = useSimulationStore((state) => state.openSettings);
  const reverseRoute = useSimulationStore((state) => state.reverseRoute);
  const undo = useSimulationStore((state) => state.undo);
  const canUndo = useSimulationStore((state) => state.undoStack.length > 0);
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);
  const setDrawArmed = useSimulationStore((state) => state.setDrawArmed);
  const resetNorth = useSimulationStore((state) => state.resetNorth);
  const hasToken = useSimulationStore((state) => state.mapboxToken !== null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture, so a tap that lands on the map closes the menu before the map handles it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`${GLASS_BUTTON} min-h-[48px] min-w-[48px] ${
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
          className={`pointer-events-auto absolute left-0 top-[calc(100%+0.5rem)] flex w-52 flex-col gap-0.5 rounded-2xl p-1.5 ${GLASS_SURFACE}`}
        >
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(() => openSettings(true))}>
            <Settings size={18} /> Settings
          </button>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(() => openHistory(true))}>
            <History size={18} /> History
          </button>
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            disabled={pointCount < 2 || isRouting}
            onClick={run(() => void reverseRoute())}
          >
            <Repeat size={18} /> Reverse route
          </button>
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            disabled={!canUndo || isRouting}
            onClick={run(undo)}
          >
            <Undo2 size={18} /> Undo
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${ITEM_CLASS} ${isDrawArmed ? 'text-amber-300' : ''}`}
            disabled={!hasToken}
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
