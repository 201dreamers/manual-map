/**
 * Update checks for the installed app.
 *
 * vite-plugin-pwa's autoUpdate mode reloads the page when a new service worker
 * reaches its `activated` event, but that only happens once an update check has
 * actually found one - and `wb.register()` checks only at registration time. iOS
 * frequently restores a standalone app from its snapshot instead of navigating
 * afresh, so relaunching can leave the old build serving indefinitely. Checking
 * whenever the app returns to the foreground, plus a manual menu entry, gives the
 * check something to hang off.
 */

export type UpdateCheck =
  /** A new worker is installing; the page reloads itself once it activates. */
  | 'updating'
  /** The server was reached and is serving the build already running. */
  | 'current'
  /** The server could not be reached, so nothing is known either way. */
  | 'unreachable'
  /** No service worker: a plain browser tab, or registration failed. */
  | 'unsupported';

let swRegistration: ServiceWorkerRegistration | null = null;

export function setServiceWorkerRegistration(
  registration: ServiceWorkerRegistration | undefined,
): void {
  swRegistration = registration ?? null;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!swRegistration) return 'unsupported';

  try {
    await swRegistration.update();
  } catch {
    // update() rejects when the worker script cannot be fetched, which offline is
    // the normal case rather than an error worth surfacing as a failure.
    return 'unreachable';
  }

  return swRegistration.installing || swRegistration.waiting ? 'updating' : 'current';
}

/**
 * Re-checks whenever the app is brought back to the foreground. Returns the
 * unsubscribe so a caller can detach it.
 */
export function watchForegroundUpdates(target: Document = document): () => void {
  const onVisible = () => {
    if (target.visibilityState === 'visible') void checkForUpdate();
  };
  target.addEventListener('visibilitychange', onVisible);
  return () => target.removeEventListener('visibilitychange', onVisible);
}
