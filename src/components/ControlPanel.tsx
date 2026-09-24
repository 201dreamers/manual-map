import { useEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, Minus, Plus } from 'lucide-react';
import { displaySpeed, formatDistance, speedLabel } from '../lib/format';
import { MAX_SPEED_KMH, useSimulationStore } from '../store/simulationStore';
import { RecenterButton } from './RecenterButton';
import { SpeedDial } from './SpeedDial';
import { DRIVE_TARGET, GLASS_BUTTON, NORMAL_TARGET, Z_CLUSTER } from './ui';

/**
 * Every playback control floats over the map as its own button, on the shared glass
 * surface used by the other overlays - nothing is grouped into a pane. Playback and
 * speed stack in one thumb column, cursor movement in the other, so neither thumb
 * crosses the map. Locking switches to the Drive layout (D-1): larger targets, and
 * the planning-only reset drops away. The lock itself lives in the top action row,
 * out of reach of a thumb resting on playback.
 */
export function ControlPanel() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const step = useSimulationStore((state) => state.step);
  const adjustSpeed = useSimulationStore((state) => state.adjustSpeed);
  // D-21: connected means the adapter writes the speed and the thumb stops owning it.
  const isObdConnected = useSimulationStore((state) => state.obd.status === 'connected');
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);

  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Publishes the cluster's real height so nothing else has to guess it. Anything that
   * must stay clear of the controls - the plan drawer, the Mapbox attribution - reads
   * `--control-cluster-height` instead of carrying its own copy of the number.
   *
   * AC-506 removed a hardcoded offset for exactly this reason: the constant had to be
   * re-derived every time the cluster changed height, and it changed four times. It
   * then changed again when V3 grew the targets to 72 and 88px, and the offsets that
   * were not updated began overlapping the step buttons. Measuring removes the class
   * of bug rather than fixing this one instance of it - the value is now correct for
   * both layouts, either mirroring, and a browser tab where the safe-area inset is 0.
   */
  useEffect(() => {
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const publish = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--control-cluster-height', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const backLabel = formatDistance(config.stepBackMeters, config.unitSystem);
  const forwardLabel = formatDistance(config.stepForwardMeters, config.unitSystem);

  const target = isRouteLocked ? DRIVE_TARGET : NORMAL_TARGET;
  const unit = speedLabel(config.unitSystem);
  const upLabel = `${Math.round(displaySpeed(config.speedStepUpKmh, config.unitSystem))} ${unit}`;
  const downLabel = `${Math.round(displaySpeed(config.speedStepDownKmh, config.unitSystem))} ${unit}`;
  // aspect-square, because the column is as wide as the dial (96px) and a stretched
  // child would render a 96x72 rectangle. The label sits comfortably inside the square:
  // the widest of them - "10 km/h" at 11px mono - is about 62px against a 72px side.
  // Circles, matching the dial below them. The label has to live inside the inscribed
  // square rather than the full width, so it drops to 10px: the widest of them,
  // "3281 ft" in imperial, is about 42px against roughly 51px of usable room at 72px.
  const stepButtonClass = `${GLASS_BUTTON} ${target} aspect-square flex-col gap-0.5 rounded-full px-1`;
  const iconSize = isRouteLocked ? 26 : 22;

  return (
    <div
      ref={panelRef}
      className={`pointer-events-none absolute inset-x-3 bottom-0 flex flex-col gap-2.5 ${Z_CLUSTER}`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`relative flex items-end justify-between gap-2 ${
          config.controlsMirrored ? 'flex-row-reverse' : ''
        }`}
      >
        {/* Out of flow on purpose: the thumb columns leave the middle of this row
            empty, so Recenter can appear and disappear there without shifting the
            play button under the thumb that is reaching for it. */}
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 justify-center">
          <RecenterButton />
        </div>

        {/* Speed in one column, reading bottom-up in order of how often a thumb reaches
            for each: the dial - play, pause and the reading in one circle - sits lowest
            and largest, with the pair that moves the speed above it. Centred rather
            than stretched, so the square buttons stay square under the wider dial. */}
        <div className="flex flex-col items-center gap-2">
          {!isObdConnected && (
            <>
            <button
              type="button"
              className={stepButtonClass}
              onClick={() => adjustSpeed(1)}
              disabled={config.speedKmh >= MAX_SPEED_KMH}
              aria-label={`Increase speed by ${upLabel}`}
            >
              <Plus size={iconSize} />
              <span className="font-mono text-[10px] leading-none">{upLabel}</span>
            </button>

            {/* Discrete increments rather than a slider: a slider asks for a precise drag,
                which is the one gesture a driver cannot give. Sized and labelled like the
                step buttons opposite, because they do the same kind of job.

                Hidden outright while the adapter is connected rather than disabled: the
                car owns the speed then, and a greyed-out pair is a control the driver has
                to look at to rule out. The store guard on `adjustSpeed` stays regardless,
                because absent UI is not the same as a closed door. */}
            <button
              type="button"
              className={stepButtonClass}
              onClick={() => adjustSpeed(-1)}
              disabled={config.speedKmh <= 0}
              aria-label={`Decrease speed by ${downLabel}`}
            >
              <Minus size={iconSize} />
              <span className="font-mono text-[10px] leading-none">{downLabel}</span>
            </button>
            </>
          )}

          <SpeedDial />
        </div>

        {/* Cursor movement in the other column. */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            className={stepButtonClass}
            onClick={() => step(1)}
            disabled={!hasRoute}
            aria-label={`Step forward ${forwardLabel}`}
          >
            <ChevronsRight size={iconSize} />
            <span className="font-mono text-[10px] leading-none">{forwardLabel}</span>
          </button>

          <button
            type="button"
            className={stepButtonClass}
            onClick={() => step(-1)}
            disabled={!hasRoute}
            aria-label={`Step back ${backLabel}`}
          >
            <ChevronsLeft size={iconSize} />
            <span className="font-mono text-[10px] leading-none">{backLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
