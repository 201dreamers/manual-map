import { useEffect, useRef } from 'react';
import { Loader2, Lock, LocateFixed, LocateOff, SkipBack, Unlock } from 'lucide-react';
import { MenuButton } from './MenuButton';
import { TelemetryPanel } from './TelemetryPanel';
import { ZoomControls } from './ZoomControls';
import { useSimulationStore } from '../store/simulationStore';
import { GLASS_BUTTON, GLASS_SURFACE } from './ui';

const BUTTON_CLASS = `${GLASS_BUTTON} min-h-[48px] min-w-[48px] gap-1 rounded-2xl px-2.5`;

/** Fixed so the spacer opposite can match it exactly and keep the hint centred. */
const LOCATE_WIDTH = 'w-[7.25rem]';

/**
 * Top overlay row: the three square controls gathered in one corner, the distance
 * panel in the other, where it also opens the stop list. Mirroring swaps the two. The status line appears
 * only when it has something to say, so it never permanently occupies a strip of map.
 */
export function TopBar() {
  const pointCount = useSimulationStore((state) => state.routePoints.length);
  const isRouting = useSimulationStore((state) => state.isRouting);
  const isDrawArmed = useSimulationStore((state) => state.isDrawArmed);
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);
  const setRouteLocked = useSimulationStore((state) => state.setRouteLocked);
  const resetToStart = useSimulationStore((state) => state.resetToStart);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const isLocating = useSimulationStore((state) => state.isLocating);
  const isPlanOpen = useSimulationStore((state) => state.isPlanOpen);
  const controlsMirrored = useSimulationStore((state) => state.config.controlsMirrored);
  const headerRef = useRef<HTMLElement>(null);

  /**
   * Publishes the row's real height, so the plan drawer starts below it instead of
   * carrying a literal. The drawer opens from the panel that now sits in this row, and
   * a hardcoded offset is exactly the constant that goes stale when the row changes -
   * which is how the panel ended up overlapping the drawer it opens.
   */
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const publish = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--top-row-height', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const toggleUserLocation = useSimulationStore((state) => state.toggleUserLocation);
  const isLocationOn = useSimulationStore((state) => state.isLocationOn);

  // Offered only while the route is empty: it seeds a start, it does not navigate.
  // Feature-detected rather than assumed, so a browser without it shows nothing at all.
  // Always offered, not only on an empty route: it reports where the device is, which
  // is just as worth knowing mid-route as before one exists.
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  // Once a route is built the row is busy, so the control drops its label and becomes
  // an icon in a circle. The crossed icon says what the next press will do, not what
  // the current state is: pressing it again removes the marker.
  const locationIsCompact = pointCount > 0;
  // Without a label beside it the icon is the whole control, so it carries the extra
  // size the circle gained: a 16px glyph centred in 56px reads as an empty disc.
  const locationIcon = locationIsCompact ? 22 : 16;

  const status = isRouting
    ? 'Calculating route'
    : isDrawArmed
      ? 'Draw a line across the map'
      : pointCount === 0
        ? 'Tap the map to set the start'
        : null;

  return (
    <>
      <header
        ref={headerRef}
        className={`flex w-full items-start justify-between gap-2 ${
          controlsMirrored ? 'flex-row-reverse' : ''
        }`}
      >
        {/* All three square controls in one corner, so the panel opposite gets the
            whole of the remaining width instead of being squeezed between them. */}
        <div className="flex shrink-0 items-start gap-2">
          <MenuButton />

          {/* D-3: the lock guards the route against stray taps while driving. */}
          <button
            type="button"
            className={`${BUTTON_CLASS} ${isRouteLocked ? 'text-amber-300 ring-amber-400' : ''}`}
            onClick={() => setRouteLocked(!isRouteLocked)}
            // Never disabled while locked: a lock you cannot release is a trap.
            disabled={!isRouteLocked && pointCount < 2}
            aria-pressed={isRouteLocked}
            aria-label={isRouteLocked ? 'Unlock route' : 'Lock route'}
          >
            {isRouteLocked ? <Lock size={20} /> : <Unlock size={20} />}
          </button>

          {/* Returning to the start is a planning action, so it goes with the Drive
            layout when the route locks - the same rule it followed in the cluster. */}
          {!isRouteLocked && (
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={resetToStart}
              disabled={!hasRoute}
              aria-label="Reset to start"
            >
              <SkipBack size={20} />
            </button>
          )}
        </div>

        {/* min-w-0 lets the panel shrink and truncate rather than push the buttons off
            the row: its width follows the route, theirs does not. */}
        <div className="flex min-w-0 justify-end">
          <TelemetryPanel />
        </div>
      </header>


      {/*
        The zoom pair, the hint and the location control share one band directly under
        the header, aligned to its top edge - so the hint and the button sit level with
        the zoom-in button rather than below the whole stack.

        The zoom pair leads the row, which puts it immediately beneath the menu and
        means a hint that comes and goes can never shunt it up and down the screen.
        Reversing the row is what carries all three to the other side when mirrored.

        The hint and the button stand down while the stop list is open - the drawer
        covers this band, so a centred hint would render on top of the list it is
        telling you how to fill. Nothing is lost: the drawer disables its own controls
        while a route calculates, and failures surface as toasts, above everything.

        The lock hides the hint but not the location button. The hint is about editing a
        route, which is exactly what the lock forbids; where the device is stays worth
        knowing while driving, and that is when it is worth knowing most.
      */}
      <div
        className={`flex w-full items-start gap-2 ${controlsMirrored ? 'flex-row-reverse' : ''}`}
      >
        <ZoomControls />

        {(status || canLocate) && !isPlanOpen && (
          <>
          <div className="flex min-w-0 flex-1 justify-center">
            {status && !isRouteLocked && (
              <p
                className={`pointer-events-none flex max-w-[8rem] items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-center text-xs font-medium leading-snug ${
                  isRouting ? 'text-sky-300' : 'text-slate-100'
                } ${GLASS_SURFACE}`}
              >
                {isRouting && <Loader2 size={13} className="shrink-0 animate-spin" />}
                {status}
              </p>
            )}
          </div>

          {canLocate && (
            <button
              type="button"
              onClick={() => void toggleUserLocation()}
              disabled={isLocating}
              aria-pressed={isLocationOn}
              aria-label={isLocationOn ? 'Hide my location' : 'Show my location'}
              className={`${GLASS_BUTTON} shrink-0 gap-1.5 text-xs ${
                locationIsCompact
                  ? 'min-h-[56px] aspect-square rounded-full px-0'
                  : `min-h-[44px] ${LOCATE_WIDTH} rounded-2xl px-3`
              } ${isLocationOn ? 'text-sky-300 ring-sky-500' : 'text-slate-100'}`}
            >
              {isLocating ? (
                <Loader2 size={locationIcon} className="animate-spin" />
              ) : isLocationOn ? (
                <LocateOff size={locationIcon} />
              ) : (
                <LocateFixed size={locationIcon} />
              )}
              {!locationIsCompact && (isLocating ? 'Locating' : isLocationOn ? 'Hide' : 'My location')}
            </button>
          )}
          </>
        )}
      </div>
    </>
  );
}
