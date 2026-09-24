import { Pause, Play } from 'lucide-react';
import { displaySpeed, speedLabel } from '../lib/format';
import { MAX_SPEED_KMH, useSimulationStore } from '../store/simulationStore';
import { DRIVE_SPEED_DIAL, GLASS_SURFACE, NORMAL_SPEED_DIAL } from './ui';

/**
 * Speed and playback as one control: a ring that fills with speed, the play/pause icon
 * in the middle, and the reading underneath it.
 *
 * The two were separate buttons sitting on top of each other, which spent height the
 * map needed and gave a thumb two round targets to tell apart by feel. Merging them
 * resolves cleanly because the interactions are not equally important - play/pause is
 * pressed constantly and must never be mis-hit, while switching km/h to mph is a
 * set-once preference. So the whole circle is one target for play/pause, and the unit
 * moved to Settings next to the speed increment it belongs with.
 *
 * The ring earns its place separately from the number: an arc length is readable
 * without focusing on it, which a two-digit number is not, and that is the difference
 * between a glance and a look while driving.
 */

/** Drawn in a fixed 100x100 box and scaled by CSS, so one geometry serves both sizes. */
const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SpeedDial() {
  const config = useSimulationStore((state) => state.config);
  const hasRoute = useSimulationStore((state) => state.geometry !== null);
  const togglePlay = useSimulationStore((state) => state.togglePlay);
  const isRouteLocked = useSimulationStore((state) => state.isRouteLocked);
  const isObdConnected = useSimulationStore((state) => state.obd.status === 'connected');

  const reading = Math.round(displaySpeed(config.speedKmh, config.unitSystem));
  const unit = speedLabel(config.unitSystem);
  const filled = Math.min(Math.max(config.speedKmh / MAX_SPEED_KMH, 0), 1);

  // Emerald while the adapter owns the speed, so the ring reads as a real instrument
  // rather than a simulation control without having to check anything else.
  const ringColour = isObdConnected ? 'stroke-emerald-400' : 'stroke-sky-500';

  return (
    <button
      type="button"
      onClick={togglePlay}
      disabled={!hasRoute}
      aria-label={`${config.isPlaying ? 'Pause simulation' : 'Play simulation'}. ${
        isObdConnected ? 'Measured vehicle speed' : 'Simulation speed'
      } ${reading} ${unit}.`}
      className={`pointer-events-auto relative mx-auto flex ${
        isRouteLocked ? DRIVE_SPEED_DIAL : NORMAL_SPEED_DIAL
      } items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${GLASS_SURFACE}`}
    >
      {/* Rotated so the arc starts at twelve o'clock rather than three. */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          className="stroke-slate-700"
        />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={`${ringColour} transition-[stroke-dasharray] duration-200`}
          strokeDasharray={`${(CIRCUMFERENCE * filled).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
        />
      </svg>

      <span className="relative flex flex-col items-center leading-none">
        {config.isPlaying ? (
          <Pause size={isRouteLocked ? 20 : 17} fill="currentColor" className="text-sky-300" />
        ) : (
          <Play size={isRouteLocked ? 20 : 17} fill="currentColor" className="text-sky-300" />
        )}
        <span
          className={`mt-1 font-mono font-semibold tabular-nums text-slate-100 ${
            isRouteLocked ? 'text-3xl' : 'text-2xl'
          }`}
        >
          {reading}
        </span>
        <span className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-400">{unit}</span>
      </span>
    </button>
  );
}
