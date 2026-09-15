import { check, report } from './harness';

type Listener = () => void;
const listeners = new Map<string, Listener[]>();
const doc = {
  visibilityState: 'visible' as DocumentVisibilityState,
  addEventListener: (type: string, fn: Listener) =>
    void listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  removeEventListener: (type: string, fn: Listener) =>
    void listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn)),
};
const fire = () => (listeners.get('visibilitychange') ?? []).forEach((fn) => fn());

const { setServiceWorkerRegistration, checkForUpdate, watchForegroundUpdates } = await import(
  '../src/lib/appUpdate'
);

function registration(overrides: Record<string, unknown> = {}) {
  return {
    installing: null,
    waiting: null,
    updateCalls: 0,
    update() {
      this.updateCalls++;
      return Promise.resolve();
    },
    ...overrides,
  } as any;
}

setServiceWorkerRegistration(undefined);
check('no worker reports unsupported', (await checkForUpdate()) === 'unsupported');

const current = registration();
setServiceWorkerRegistration(current);
check('a matching build reports current', (await checkForUpdate()) === 'current');
check('the check hits the server', current.updateCalls === 1);

setServiceWorkerRegistration(registration({ installing: {} }));
check('an installing worker reports updating', (await checkForUpdate()) === 'updating');

setServiceWorkerRegistration(registration({ waiting: {} }));
check('a waiting worker reports updating', (await checkForUpdate()) === 'updating');

setServiceWorkerRegistration(
  registration({ update: () => Promise.reject(new Error('offline')) }),
);
check('an unreachable server is not an error', (await checkForUpdate()) === 'unreachable');

// Returning to the foreground is what triggers a check on an installed app.
const tracked = registration();
setServiceWorkerRegistration(tracked);
const stop = watchForegroundUpdates(doc as unknown as Document);
fire();
await Promise.resolve();
check('a foreground return checks for updates', tracked.updateCalls === 1);

doc.visibilityState = 'hidden';
fire();
await Promise.resolve();
check('backgrounding does not check', tracked.updateCalls === 1);

doc.visibilityState = 'visible';
stop();
fire();
await Promise.resolve();
check('detaching stops the checks', tracked.updateCalls === 1);

report('update');
