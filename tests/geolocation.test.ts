import { check, report } from './harness';
import { chooseHeading, MOVING_SPEED_MS, normalizeDegrees } from '../src/lib/geolocation';

/*
 * The handover between the two heading sources. GPS course is the direction of travel
 * and is unaffected by the steel box the phone is sitting in; the compass is the only
 * thing that knows which way you face at a standstill, where GPS has no successive
 * positions to derive a course from.
 */

check('GPS course wins while moving', chooseHeading(90, 12, 270) === 90,
  String(chooseHeading(90, 12, 270)));
check('the compass takes over at rest', chooseHeading(90, 0, 270) === 270,
  String(chooseHeading(90, 0, 270)));
check('a crawl below the threshold still counts as at rest',
  chooseHeading(90, MOVING_SPEED_MS - 0.01, 270) === 270);
check('exactly at the threshold counts as moving',
  chooseHeading(90, MOVING_SPEED_MS, 270) === 90);

// Some devices report a heading but never a speed; refusing to use the better source
// on that hardware would be worse than trusting it.
check('a heading with no speed reported is trusted', chooseHeading(90, null, 270) === 90);

check('the compass alone is used when GPS has no course',
  chooseHeading(null, 12, 270) === 270);
check('no source means no arrow', chooseHeading(null, 12, null) === null);
check('NaN is not a heading', chooseHeading(Number.NaN, 12, Number.NaN) === null);
check('a stationary device with no compass shows no arrow',
  chooseHeading(90, 0, null) === null, String(chooseHeading(90, 0, null)));

// Whatever comes back is wrapped, because a marker rotation of -90 or 450 is a bug
// that only shows up as an arrow pointing the wrong way.
check('negative bearings wrap', chooseHeading(-90, 12, null) === 270);
check('bearings past a full turn wrap', chooseHeading(450, 12, null) === 90);
check('normalize is exact at the seam', normalizeDegrees(360) === 0 && normalizeDegrees(0) === 0);
check('normalize handles large negatives', normalizeDegrees(-450) === 270);

report('geolocation');
