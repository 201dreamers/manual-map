import { check, report } from './harness';
import { AppError, isUserSafeMessage, userFacingMessage } from '../src/lib/errors';
import { DirectionsError } from '../src/lib/directions';
import { TrafficError } from '../src/lib/traffic';
import { GeocodingError } from '../src/lib/geocoding';
import { ObdError } from '../src/lib/obd/transport';

const FALLBACK = 'Something went wrong.';

/* ---------------- only authored errors speak ---------------- */

check('AC-750 an app error shows its own message',
  userFacingMessage(new AppError('Route is locked.'), FALLBACK) === 'Route is locked.');

// Every app-level class has to descend from AppError or its message is silently dropped.
for (const [name, error] of [
  ['DirectionsError', new DirectionsError('No road route between those points.')],
  ['TrafficError', new TrafficError('TomTom rejected the API key.')],
  ['GeocodingError', new GeocodingError('Address search failed.')],
  ['ObdError', new ObdError('The adapter stopped responding.')],
] as const) {
  check(`AC-750 ${name} reaches the driver`,
    userFacingMessage(error, FALLBACK) !== FALLBACK, name);
  check(`AC-750 ${name} descends from AppError`, error instanceof AppError);
}

/* ---------------- everything else is replaced ---------------- */

check('AC-751 a plain Error is replaced',
  userFacingMessage(new Error('boom'), FALLBACK) === FALLBACK);
check('AC-751 a TypeError from a real bug is replaced',
  userFacingMessage(
    new TypeError("Cannot read properties of undefined (reading 'server')"),
    FALLBACK,
  ) === FALLBACK);
check('AC-751 a thrown string is replaced',
  userFacingMessage('raw string', FALLBACK) === FALLBACK);
check('AC-751 a thrown object is replaced',
  userFacingMessage({ message: 'leak' }, FALLBACK) === FALLBACK);
check('AC-751 null is replaced', userFacingMessage(null, FALLBACK) === FALLBACK);
check('AC-751 undefined is replaced', userFacingMessage(undefined, FALLBACK) === FALLBACK);

// The specific strings the Web Bluetooth stack throws, which is the path that leaked.
for (const message of [
  "Failed to execute 'requestDevice' on 'Bluetooth': Must be handling a user gesture",
  'GATT Server is disconnected. Cannot retrieve services.',
  'NetworkError: Unable to connect to the device.',
  'User cancelled the requestDevice() chooser.',
]) {
  check('AC-751 a browser message is replaced',
    userFacingMessage(new Error(message), FALLBACK) === FALLBACK, message.slice(0, 40));
}

/* ---------------- the second line of defence ---------------- */

check('AC-752 an ordinary sentence is safe',
  isUserSafeMessage('The adapter stopped responding.'));
check('AC-752 a sentence with a number is safe',
  isUserSafeMessage('A route can use at most 25 points.'));

// An authored message that grew a template hole filled with something technical: this is
// exactly how the OBD timeout message came to carry the raw AT command.
check('AC-752 a raw AT command is caught', !isUserSafeMessage('No reply to ATZ within 1000 ms.'));
check('AC-752 a raw PID is caught', !isUserSafeMessage('No reply to 010D1 within 1000 ms.'));
check('AC-752 a UUID is caught',
  !isUserSafeMessage('Characteristic 0000fff1-0000-1000-8000-00805f9b34fb not found.'));
check('AC-752 a stack frame is caught',
  !isUserSafeMessage('at connectObd (simulationStore.ts:1042:11)'));
check('AC-752 a file and line is caught', !isUserSafeMessage('Crashed in transport.ts:144'));
check('AC-752 an error class name is caught', !isUserSafeMessage('TypeError: bad input'));
check('AC-752 a property path is caught',
  !isUserSafeMessage("Cannot read properties of undefined (reading 'gatt')"));
check('AC-752 undefined leaking into a template is caught',
  !isUserSafeMessage('Could not reach undefined.'));
check('AC-752 NaN leaking into a template is caught',
  !isUserSafeMessage('Speed was NaN km/h.'));
check('AC-752 a stringified object is caught', !isUserSafeMessage('[object Object]'));
check('AC-752 an arrow function is caught', !isUserSafeMessage('failed in () => poll()'));
check('AC-752 a native code marker is caught',
  !isUserSafeMessage('function connect() { [native code] }'));

check('AC-752 an empty message is not safe', !isUserSafeMessage(''));
check('AC-752 whitespace is not safe', !isUserSafeMessage('   '));
check('AC-752 a multi-line dump is not safe', !isUserSafeMessage('Failed.\nat foo (a.ts:1:1)'));
check('AC-752 an overlong message is not safe', !isUserSafeMessage('x'.repeat(161)));
check('AC-752 a message at the limit is safe', isUserSafeMessage('x'.repeat(160)));
check('AC-752 a non-string is not safe', !isUserSafeMessage(42));

// The gate is type-first, so even an AppError carrying code-shaped text is withheld.
check('AC-753 an app error with a leaked stack still falls back',
  userFacingMessage(new AppError('at connect (transport.ts:144:9)'), FALLBACK) === FALLBACK);
check('AC-753 an app error with a UUID still falls back',
  userFacingMessage(
    new ObdError('No characteristic 0000fff1-0000-1000-8000-00805f9b34fb.'),
    FALLBACK,
  ) === FALLBACK);

/* ---------------- every authored message in the app passes ---------------- */

const AUTHORED = [
  'Unable to calculate road route between selected points',
  'Route calculation failed.',
  'Address search failed.',
  'Could not load traffic incidents.',
  'Could not reach the adapter.',
  'The adapter stopped responding.',
  'The adapter disconnected mid-command.',
  'The OBD adapter disconnected.',
  'Web Bluetooth is unavailable in this browser.',
  'This does not look like a supported OBD adapter.',
  'The adapter did not accept the connection.',
  'Add a Mapbox public token in Settings first.',
  'That saved route is corrupted and cannot be loaded.',
  'This browser cannot report a location.',
  'Location permission was declined.',
  'Timed out waiting for a location fix.',
  'Could not get a location fix.',
  'TomTom rejected the API key.',
  'TomTom rate limit reached. Traffic will refresh shortly.',
  'TomTom rejected the map area.',
  'Network error while contacting the TomTom Traffic API.',
  'Mapbox rejected the access token. Check it in Settings.',
  'Mapbox rate limit reached. Try again in a moment.',
  'A route can use at most 25 points.',
];
for (const message of AUTHORED) {
  check('AC-754 an authored message survives the filter', isUserSafeMessage(message), message);
}

report('errors');
