import { useEffect } from 'react';
import { useSimulationStore } from '../store/simulationStore';

/** React telemetry refreshes 8x per second; the map still moves at full frame rate. */
const DISPLAY_SYNC_INTERVAL_MS = 125;
/** Guards against huge jumps after the tab was throttled or backgrounded. */
const MAX_FRAME_DELTA_SECONDS = 0.25;

/**
 * Drives the simulation from a single requestAnimationFrame loop that reads and
 * writes the store imperatively, so the 60 FPS tick never re-renders the React tree.
 */
export function useAnimationLoop(): void {
  useEffect(() => {
    let frameId = 0;
    let lastTickMs = performance.now();
    let lastDisplaySyncMs = 0;

    const tick = (nowMs: number) => {
      frameId = requestAnimationFrame(tick);

      const deltaSeconds = Math.min((nowMs - lastTickMs) / 1000, MAX_FRAME_DELTA_SECONDS);
      lastTickMs = nowMs;

      const store = useSimulationStore.getState();
      if (!store.config.isPlaying) return;

      store.advance(deltaSeconds);

      if (nowMs - lastDisplaySyncMs >= DISPLAY_SYNC_INTERVAL_MS) {
        lastDisplaySyncMs = nowMs;
        useSimulationStore.getState().syncDisplayTelemetry();
      }
    };

    // Playback is foreground-only: a hidden tab pauses instead of drifting.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastTickMs = performance.now();
      } else if (useSimulationStore.getState().config.isPlaying) {
        useSimulationStore.getState().pause();
        useSimulationStore.getState().syncDisplayTelemetry();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
