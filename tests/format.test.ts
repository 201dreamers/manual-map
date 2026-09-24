import { check, report } from './harness';
import {
  displaySpeed,
  distanceMajorLabel,
  formatDistance,
  formatDistanceMajor,
  formatEta,
  speedFromDisplay,
  speedLabel,
} from '../src/lib/format';

check('metric speed passes through', displaySpeed(180, 'metric') === 180);
check('imperial speed converts', Math.abs(displaySpeed(100, 'imperial') - 62.1371) < 1e-3,
  `${displaySpeed(100, 'imperial').toFixed(4)}`);
check('speed labels follow the system',
  speedLabel('metric') === 'km/h' && speedLabel('imperial') === 'mph');

// Settings are typed in whatever is on screen, so the round trip has to survive.
check('a metric speed round-trips unchanged', speedFromDisplay(10, 'metric') === 10);
check('an imperial speed round-trips within a rounding step',
  Math.abs(Math.round(displaySpeed(Math.round(speedFromDisplay(5, 'imperial')), 'imperial')) - 5) <= 1,
  `${Math.round(speedFromDisplay(5, 'imperial'))} km/h`);

check('metres below 1 km', formatDistance(250) === '250 m', formatDistance(250));
check('kilometres above 1 km', formatDistance(15234) === '15.2 km', formatDistance(15234));
check('metric is the default system', formatDistance(250) === formatDistance(250, 'metric'));
check('distance handles NaN', formatDistance(Number.NaN) === '--');

// Imperial mirrors the metric shape: a small unit up to a crossover, a large one above.
check('feet below the crossover', formatDistance(250, 'imperial') === '820 ft',
  formatDistance(250, 'imperial'));
check('miles above it', formatDistance(15234, 'imperial') === '9.5 mi',
  formatDistance(15234, 'imperial'));
check('the crossover is 1000 ft, not 1 mile',
  formatDistance(400, 'imperial').endsWith('mi'), formatDistance(400, 'imperial'));
check('imperial distance handles NaN', formatDistance(Number.NaN, 'imperial') === '--');

check('major unit is km in metric', distanceMajorLabel('metric') === 'km');
check('major unit is mi in imperial', distanceMajorLabel('imperial') === 'mi');
check('major distance converts', formatDistanceMajor(1609.344, 'imperial') === '1.0',
  formatDistanceMajor(1609.344, 'imperial'));
check('major distance in metric', formatDistanceMajor(1500, 'metric') === '1.5',
  formatDistanceMajor(1500, 'metric'));

check('ETA under a minute', formatEta(30) === '1 min', formatEta(30));
check('ETA minutes', formatEta(29 * 60) === '29 min', formatEta(29 * 60));
check('ETA hours and minutes', formatEta(3 * 3600 + 25 * 60) === '3 h 25 min',
  formatEta(3 * 3600 + 25 * 60));
check('ETA exact hours', formatEta(2 * 3600) === '2 h', formatEta(2 * 3600));
check('ETA when stopped is not a number', formatEta(Number.POSITIVE_INFINITY) === '--');
check('ETA at destination', formatEta(0) === '0 min', formatEta(0));

// The floating telemetry pills are sized for these; a regression here means overflow.
const widest = Math.max(
  ...(['metric', 'imperial'] as const).flatMap((system) => [
    `${Math.round(displaySpeed(180, system))} ${speedLabel(system)}`.length,
    `${formatDistanceMajor(999999, system)} ${distanceMajorLabel(system)}`.length,
    formatEta(3 * 3600 + 25 * 60).length,
    `${formatDistanceMajor(999999, system)}/${formatDistanceMajor(999999, system)} ${distanceMajorLabel(system)}`.length,
  ]),
);
check('widest telemetry value still fits a compact card', widest <= 20, `${widest} chars`);

report('format');
