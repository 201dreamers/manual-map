import { Minus, Plus } from 'lucide-react';
import { ZOOM_STEP } from '../lib/camera';
import { useSimulationStore } from '../store/simulationStore';
import { DRIVE_ZOOM_TARGET, GLASS_BUTTON, NORMAL_ZOOM_TARGET } from './ui';

/**
 * D-7: look-ahead zoom. Stacked directly under the menu, in whichever corner the menu
 * occupies, clear
 * of both thumb clusters, so widening the view to see the road ahead never competes
 * with the playback controls for space. It is rendered by `TopBar` immediately after
 * the header rather than after the status line, so the transient hint below cannot
 * push it down the screen. It grows with the Drive layout like the rest, and it yields
 * the corner while the menu is open. Its side is decided by the row that holds it, so
 * it follows the menu across when the controls are mirrored.
 */
export function ZoomControls() {
  const requestZoom = useSimulationStore((state) => state.requestZoom);
  const hasToken = useSimulationStore((state) => state.mapboxToken !== null);
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);
  const isMenuOpen = useSimulationStore((state) => state.isMenuOpen);

  const buttonClass = `${GLASS_BUTTON} ${isRouteLocked ? DRIVE_ZOOM_TARGET : NORMAL_ZOOM_TARGET} aspect-square rounded-full`;

  // The menu drops into this exact corner, so the stack stands down rather than
  // fighting it for the same pixels and catching taps meant for a menu entry.
  if (isMenuOpen) return null;

  return (
    <div className="flex w-fit shrink-0 flex-col gap-2">
      <button
        type="button"
        className={buttonClass}
        onClick={() => requestZoom(ZOOM_STEP)}
        disabled={!hasToken}
        aria-label="Zoom in"
      >
        <Plus size={18} />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => requestZoom(-ZOOM_STEP)}
        disabled={!hasToken}
        aria-label="Zoom out to see the road ahead"
      >
        <Minus size={18} />
      </button>
    </div>
  );
}
