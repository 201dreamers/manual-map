import { check, report } from './harness';
import {
  displaySpeed,
  formatDistance,
  formatDistanceKm,
  formatEta,
  speedLabel,
} from '../src/lib/format';

check('km/h passes through', displaySpeed(180, 'kmh') === 180);
check('mph conversion', Math.abs(displaySpeed(100, 'mph') - 62.1371) < 1e-3,
  `${displaySpeed(100, 'mph').toFixed(4)}`);
check('unit labels', speedLabel('kmh') === 'km/h' && speedLabel('mph') === 'mph');

check('metres below 1 km', formatDistance(250) === '250 m', formatDistance(250));
check('kilometres above 1 km', formatDistance(15234) === '15.2 km', formatDistance(15234));
check('distance handles NaN', formatDistance(Number.NaN) === '--');

check('ETA under a minute', formatEta(30) === '1 min', formatEta(30));
check('ETA minutes', formatEta(29 * 60) === '29 min', formatEta(29 * 60));
check('ETA hours and minutes', formatEta(3 * 3600 + 25 * 60) === '3 h 25 min',
  formatEta(3 * 3600 + 25 * 60));
check('ETA exact hours', formatEta(2 * 3600) === '2 h', formatEta(2 * 3600));
check('ETA when stopped is not a number', formatEta(Number.POSITIVE_INFINITY) === '--');
check('ETA at destination', formatEta(0) === '0 min', formatEta(0));

// The floating telemetry pills are sized for these; a regression here means overflow.
const widest = Math.max(
  `${Math.round(displaySpeed(180, 'kmh'))} ${speedLabel('kmh')}`.length,
  `${formatDistanceKm(999999)} km`.length,
  formatEta(3 * 3600 + 25 * 60).length,
  `${formatDistanceKm(999999)}/${formatDistanceKm(999999)} km`.length,
);
check('widest telemetry value still fits a compact card', widest <= 20, `${widest} chars`);

report('format');
