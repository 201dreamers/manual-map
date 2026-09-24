import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  check,
  createFakeObdTransport,
  installStorageStub,
  obdSupportBitmap,
  report,
  settleStepAnimation,
  stubDirections,
} from './harness';

installStorageStub();

// D-24 keys off `navigator.bluetooth`, so a node process is correctly `unavailable`.
// Modelling a browser that does have the API is the whole point of this suite; the
// absent case is asserted separately in AC-613.
// Node ships its own read-only `navigator`, so this is defined over it rather than
// assigned. `isWebBluetoothAvailable()` only tests for the key.
Object.defineProperty(globalThis, 'navigator', {
  value: { bluetooth: {} },
  configurable: true,
  writable: true,
});

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const { useSimulationStore, setObdTransportFactory } = await import('../src/store/simulationStore');
const { ControlPanel } = await import('../src/components/ControlPanel');
const { MenuButton } = await import('../src/components/MenuButton');
const { settingsRepository } = await import('../src/lib/storage');

const s = () => useSimulationStore.getState();

/** Reads the disabled state of the button carrying a given aria-label. */
const isDisabled = (markup: string, label: string): boolean | null => {
  const at = markup.indexOf(`aria-label="${label}"`);
  if (at === -1) return null;
  return markup.slice(markup.lastIndexOf('<button', at), at).includes('disabled=""');
};

/** 0x49 is 73 km/h. The adapter reports it consistently, so a poll tick is idempotent. */
const SPEED_KMH = 73;
const respondWith = (odometerSupported: boolean) => (command: string) => {
  if (command.startsWith('AT')) return ['OK\r\r>'];
  if (command.startsWith('0100')) return [`${obdSupportBitmap(0x00, [0x0d])}\r\r>`];
  if (command.startsWith('01A0')) {
    return [`${obdSupportBitmap(0xa0, odometerSupported ? [0xa6] : [0xa1])}\r\r>`];
  }
  if (command.startsWith('010D')) return ['41 0D 49\r\r>'];
  if (command.startsWith('01A6')) return ['41 A6 00 00 00 64\r\r>'];
  return ['NO DATA\r\r>'];
};

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('fixture: route built', s().geometry !== null);

// Zustand v5 serves `getInitialState()` to a server render, so rendering a chosen
// state means writing onto that snapshot. Same approach as tests/layout.test.ts.
const initialSnapshot = useSimulationStore.getInitialState() as unknown as Record<string, unknown>;
const render = (overrides: Record<string, unknown> = {}) => {
  Object.assign(initialSnapshot, useSimulationStore.getState(), overrides);
  return renderToStaticMarkup(createElement(ControlPanel));
};
const renderMenu = (overrides: Record<string, unknown> = {}) => {
  Object.assign(initialSnapshot, useSimulationStore.getState(), { isMenuOpen: true }, overrides);
  return renderToStaticMarkup(createElement(MenuButton));
};

/* ---------------- AC-611: a connected adapter writes the slider ---------------- */
{
  setObdTransportFactory(() => createFakeObdTransport(respondWith(true)));
  await s().connectObd();

  check('AC-611 the adapter reports as connected', s().obd.status === 'connected', s().obd.status);
  check('AC-611 the odometer probe was honoured', s().obd.odometerSupported);
  check('AC-611 the adapter identified itself or admitted it could not', s().obd.adapterName === null);

  s().applyObdSpeed(SPEED_KMH, 1000);
  check('AC-611 config.speedKmh carries the measured value', s().config.speedKmh === SPEED_KMH, String(s().config.speedKmh));

  const markup = render();
  check('AC-611 the speedometer is relabelled as a readout', markup.includes('Measured vehicle speed'));
  check('AC-611 the displayed number is the measured speed', markup.includes('>73<'));
  // Hidden, not disabled: the car owns the speed, so a greyed-out pair would be a
  // control the driver has to look at only to rule out.
  check('AC-611 the increase button is gone', !markup.includes('Increase speed by'));
  check('AC-611 the decrease button is gone', !markup.includes('Decrease speed by'));
  check('AC-611 the dial itself stays', markup.includes('Play simulation'));

  // Neither a button press nor a programmatic call may desync the reading.
  s().setSpeed(120);
  check('AC-611 a direct write cannot change a measured speed', s().config.speedKmh === SPEED_KMH, String(s().config.speedKmh));
  s().adjustSpeed(1);
  check('AC-611 nor can the increment buttons', s().config.speedKmh === SPEED_KMH, String(s().config.speedKmh));
}

/* ---------------- Cursor only follows once Play is pressed ---------------- */
{
  s().pause();
  s().moveCursorTo(100);
  settleStepAnimation(s);
  const before = s().telemetry.currentDistanceMeters;
  s().applyObdSpeed(SPEED_KMH, 2000);
  s().applyObdSpeed(SPEED_KMH, 2500);
  check(
    'a paused session shows speed without moving the cursor',
    s().telemetry.currentDistanceMeters === before,
    `${s().telemetry.currentDistanceMeters} vs ${before}`,
  );
}

/* ---------------- AC-614: route end clamps ---------------- */
{
  // The real geometry is measured from the coordinates, so it is not exactly the
  // stubbed 2000 m. Start a fixed distance back from whatever it actually is.
  const total = s().geometry!.totalDistanceMeters;
  s().moveCursorTo(total - 60);
  settleStepAnimation(s);
  s().play();
  const toastsBefore = s().toasts.length;

  // Drive until it arrives rather than assuming a sample count: the first sample after
  // a long pause is discarded by the DT_MAX guard, which would otherwise be invisible.
  let clock = 10_000;
  for (let i = 0; i < 12 && s().config.isPlaying; i++) {
    clock += 2500;
    s().applyObdSpeed(SPEED_KMH, clock);
  }
  check(
    'AC-614 distance clamps at the route end',
    Math.abs(s().telemetry.currentDistanceMeters - total) < 0.001,
    `${s().telemetry.currentDistanceMeters.toFixed(2)} of ${total.toFixed(2)} m`,
  );
  check('AC-614 playback stops', !s().config.isPlaying);
  check('AC-614 exactly one toast is raised', s().toasts.length === toastsBefore + 1, `${s().toasts.length - toastsBefore}`);

  // Further samples at the end must not raise the toast again.
  s().applyObdSpeed(SPEED_KMH, 13_000);
  check('AC-614 arrival is announced once, not once per sample', s().toasts.length === toastsBefore + 1);
}

/* ---------------- Calibration is derived and persisted ---------------- */
{
  s().pause();
  let clock = 20_000;
  const feed = (samples: number) => {
    for (let i = 0; i < samples; i++) {
      clock += 250;
      s().applyObdSpeed(100, clock);
    }
  };

  feed(300);
  s().applyObdOdometer(0); // origin
  check('calibration is not claimed before the odometer moves', !s().obd.isCalibrated);

  feed(300);
  // 22 counts of 0.1 km is 2200 m against roughly 2094 m integrated: about 1.05.
  s().applyObdOdometer(22);

  check('k is derived from the odometer', s().obd.isCalibrated);
  check('k lands near the real scale error', s().obd.calibration > 1.03 && s().obd.calibration < 1.07, s().obd.calibration.toFixed(4));
  check(
    'k is persisted, because it describes the car not the trip',
    Math.abs(settingsRepository.read().obdCalibration - s().obd.calibration) < 1e-9,
    settingsRepository.read().obdCalibration.toFixed(4),
  );
}

/* ---------------- AC-612: disconnect restores manual control ---------------- */
{
  const speedAtDisconnect = s().config.speedKmh;
  const toastsBefore = s().toasts.length;
  await s().disconnectObd();

  check('AC-612 status returns to disconnected', s().obd.status === 'disconnected', s().obd.status);
  check('AC-612 the slider retains its last value', s().config.speedKmh === speedAtDisconnect, String(s().config.speedKmh));

  s().setSpeed(42);
  check('AC-612 the slider is writable again', s().config.speedKmh === 42, String(s().config.speedKmh));

  const markup = render();
  check('AC-612 the increment buttons come back', markup.includes('Increase speed by 10 km/h'));
  check('AC-612 and are pressable', isDisabled(markup, 'Increase speed by 10 km/h') === false);
  check('AC-612 the label returns to the simulation wording', markup.includes('Simulation speed'));

  const distanceBefore = s().telemetry.currentDistanceMeters;
  await new Promise((resolve) => setTimeout(resolve, 60));
  check('AC-612 the cursor stops advancing once disconnected', s().telemetry.currentDistanceMeters === distanceBefore);
  check('AC-612 no spurious toast on a clean disconnect', s().toasts.length === toastsBefore);
}

/* ---------------- AC-613: no Bluetooth, no regression ---------------- */
{
  const available = renderMenu({ obd: { ...s().obd, status: 'disconnected' } });
  const unavailable = renderMenu({ obd: { ...s().obd, status: 'unavailable' } });

  check('AC-613 no OBD affordance renders when the API is absent', !unavailable.includes('OBD'), 'menu markup');
  check('AC-613 the control does render when it is available', available.includes('Connect OBD'));

  const countButtons = (markup: string) => (markup.match(/<button/g) ?? []).length;
  check(
    'AC-613 the unavailable tree is exactly the available tree minus one control',
    countButtons(available) - countButtons(unavailable) === 1,
    `${countButtons(available)} vs ${countButtons(unavailable)}`,
  );
  check(
    'AC-613 nothing else about the menu shifts',
    unavailable.includes('Settings') && unavailable.includes('History') && !unavailable.includes('Bluetooth'),
  );
}

/* ---------------- An odometer-less car is told, not hidden ---------------- */
{
  const transport = createFakeObdTransport(respondWith(false));
  setObdTransportFactory(() => transport);
  const toastsBefore = s().toasts.length;
  await s().connectObd();

  check('a car without 01A6 reports no odometer', !s().obd.odometerSupported);
  check('the driver is told once', s().toasts.length === toastsBefore + 1);
  check(
    '01A6 is never requested when the bitmap says it is absent',
    !transport.sent.some((command) => command.toUpperCase().startsWith('01A6')),
    transport.sent.join(' '),
  );
  await s().disconnectObd();
}

/* ---------------- A dropped link is surfaced, not swallowed ---------------- */
{
  const transport = createFakeObdTransport(respondWith(true));
  setObdTransportFactory(() => transport);
  await s().connectObd();
  const toastsBefore = s().toasts.length;

  transport.dropLink();
  await new Promise((resolve) => setTimeout(resolve, 10));

  check('a dropped link returns to disconnected', s().obd.status === 'disconnected', s().obd.status);
  check('a dropped link raises exactly one toast', s().toasts.length === toastsBefore + 1);
  await s().disconnectObd();
}

report('obd-store');
