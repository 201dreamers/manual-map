import { useEffect, useRef } from 'react';

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/**
 * Holds a screen wake lock while `active` is true so an iPhone does not dim during
 * playback, and re-acquires it when the tab becomes visible again (iOS drops the
 * sentinel whenever the page is backgrounded).
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };

    const acquire = async () => {
      if (!active || document.visibilityState !== 'visible' || sentinelRef.current) return;
      try {
        const sentinel = await wakeLock.request('screen');
        if (cancelled || !active) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Denied locks (low battery, unsupported browser) are non-fatal.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
      else release();
    };

    if (active) void acquire();
    else release();

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      release();
    };
  }, [active]);
}
