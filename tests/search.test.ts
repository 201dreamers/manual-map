import { check, report } from './harness';

const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { localStorage: ls, setTimeout: () => 0 };
(globalThis as any).localStorage = ls;

const ROUTE: [number, number][] = [[30.5, 50.45], [30.5, 50.459], [30.5, 50.468]];

interface Call { url: string; aborted: boolean }
let calls: Call[] = [];
let geocodeDelayMs = 0;
let geocodeStatus = 200;
let geocodeFeatures: unknown[] = [];

function feature(id: string, name: string, lng: number, lat: number) {
  return {
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      mapbox_id: id,
      name,
      full_address: `${name}, Kyiv, Ukraine`,
      coordinates: { longitude: lng, latitude: lat },
    },
  };
}

(globalThis as any).fetch = async (url: string, init?: { signal?: AbortSignal }) => {
  const call: Call = { url, aborted: false };
  calls.push(call);

  if (url.includes('/directions/')) {
    return { ok: true, status: 200,
      json: async () => ({ code: 'Ok', routes: [{ distance: 2000, geometry: { coordinates: ROUTE } }] }) };
  }

  if (geocodeDelayMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = globalThis.setTimeout(resolve, geocodeDelayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        call.aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }
  if (init?.signal?.aborted) {
    call.aborted = true;
    throw new DOMException('Aborted', 'AbortError');
  }

  return { ok: geocodeStatus === 200, status: geocodeStatus,
    json: async () => ({ features: geocodeFeatures }) };
};

const { useSimulationStore, SEARCH_DEBOUNCE_MS, MIN_SEARCH_LENGTH } =
  await import('../src/store/simulationStore');
const { searchPlaces, GeocodingError } = await import('../src/lib/geocoding');

const s = () => useSimulationStore.getState();
const sleep = (ms: number) => new Promise((r) => globalThis.setTimeout(r, ms));
const settleSearch = () => sleep(SEARCH_DEBOUNCE_MS + 150);
const geocodeCalls = () => calls.filter((c) => c.url.includes('/geocode/'));

s().setToken('pk.' + 'a'.repeat(60));
geocodeFeatures = [feature('a', 'Khreshchatyk 1', 30.52, 50.45)];

// ---------- AC-301: debounce, abort, ordering ----------
calls = [];
s().setSearchQuery('Kh');
await settleSearch();
check('AC-301 below minimum length sends nothing', geocodeCalls().length === 0,
  `${geocodeCalls().length}, min=${MIN_SEARCH_LENGTH}`);
check('AC-301 short query clears results', s().searchResults.length === 0);

calls = [];
s().setSearchQuery('Khre');
check('AC-301 no request before the debounce elapses', geocodeCalls().length === 0);
await settleSearch();
check('AC-301 one settled query issues a request', geocodeCalls().length >= 1,
  `${geocodeCalls().length}`);
check('AC-301 results applied', s().searchResults.length === 1, `${s().searchResults.length}`);
check('AC-301 spinner cleared', !s().isSearching);

// Rapid typing collapses to a single settled query.
calls = [];
s().setSearchQuery('K');
s().setSearchQuery('Kh');
s().setSearchQuery('Khr');
s().setSearchQuery('Khre');
s().setSearchQuery('Khresh');
await settleSearch();
const bursts = geocodeCalls().filter((c) => c.url.includes('Khresh')).length;
check('AC-301 typing burst produces one settled query', bursts >= 1 && geocodeCalls().length <= 2,
  `${geocodeCalls().length} calls`);

// A slow earlier query must not overwrite a newer one.
geocodeDelayMs = 400;
geocodeFeatures = [feature('stale', 'STALE RESULT', 1, 1)];
s().setSearchQuery('slow query');
await sleep(SEARCH_DEBOUNCE_MS + 30);
geocodeFeatures = [feature('fresh', 'FRESH RESULT', 2, 2)];
s().setSearchQuery('fresh query');
await sleep(1200);
geocodeDelayMs = 0;
check('AC-301 in-flight query aborted by a newer one',
  calls.some((c) => c.aborted), `aborted=${calls.filter((c) => c.aborted).length}`);
check('AC-301 newest results win',
  s().searchResults.every((r) => r.name === 'FRESH RESULT'),
  s().searchResults.map((r) => r.name).join(','));

// ---------- AC-302: chooser places the stop correctly ----------
s().clearSearch();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
const original = s().routePoints.map((p) => p.id);

await s().applySearchResult(
  { id: 'x', name: 'New Start', address: '', coordinate: [30.4, 50.4] }, 'start');
check('AC-302 set start replaces W0', s().routePoints[0].label === 'New Start');
check('AC-302 set start keeps the other stops', s().routePoints.length === 2);
check('AC-302 set start preserves the end', s().routePoints[1].id === original[1]);

await s().applySearchResult(
  { id: 'y', name: 'Mid Stop', address: '', coordinate: [30.45, 50.43] }, 'via');
check('AC-302 via inserted before the end', s().routePoints.length === 3
  && s().routePoints[1].label === 'Mid Stop');
check('AC-302 via keeps the end last', s().routePoints[2].id === original[1]);

await s().applySearchResult(
  { id: 'z', name: 'New End', address: '', coordinate: [30.6, 50.5] }, 'end');
check('AC-302 set end replaces the last stop',
  s().routePoints[s().routePoints.length - 1].label === 'New End');
check('AC-302 set end keeps stop count', s().routePoints.length === 3);
check('AC-302 via survives the end replacement', s().routePoints[1].label === 'Mid Stop');

// Roles on an empty route.
s().clearRoute();
await s().applySearchResult(
  { id: 'q', name: 'Only Stop', address: '', coordinate: [30.4, 50.4] }, 'end');
check('AC-302 end on an empty route just adds a stop', s().routePoints.length === 1);

// ---------- AC-303: labels reach the drawer and the title ----------
s().clearRoute();
await s().applySearchResult(
  { id: '1', name: 'Khreshchatyk 1', address: '', coordinate: [30.52, 50.45] }, 'start');
await s().applySearchResult(
  { id: '2', name: 'Boryspil Airport', address: '', coordinate: [30.89, 50.34] }, 'end');
check('AC-303 stops carry their labels',
  s().routePoints.map((p) => p.label).join(' | ') === 'Khreshchatyk 1 | Boryspil Airport',
  s().routePoints.map((p) => p.label).join(' | '));
check('AC-303 title uses labels, not coordinates',
  s().activeRoute?.title === 'Khreshchatyk 1 → Boryspil Airport', s().activeRoute?.title ?? '-');

// ---------- AC-304: token rejection ----------
const routeBefore = s().routePoints.length;
geocodeStatus = 401;
s().setSearchQuery('anything here');
await settleSearch();
check('AC-304 401 surfaces the settings hint',
  s().searchError === 'Mapbox rejected the access token. Check it in Settings.',
  s().searchError ?? '-');
check('AC-304 route untouched by a failed search', s().routePoints.length === routeBefore);
check('AC-304 spinner cleared on error', !s().isSearching);

geocodeStatus = 429;
s().setSearchQuery('rate limited');
await settleSearch();
check('AC-304 429 surfaces a rate-limit message',
  s().searchError === 'Search rate limit reached. Try again in a moment.', s().searchError ?? '-');
geocodeStatus = 200;

// ---------- viewport bbox handling ----------
calls = [];
geocodeFeatures = [feature('v', 'Local', 30.5, 50.45)];
s().setViewport([30.2, 50.2, 30.9, 50.6]);
s().setSearchQuery('local search');
await settleSearch();
const withBbox = geocodeCalls().filter((c) => c.url.includes('bbox=')).length;
const withoutBbox = geocodeCalls().filter((c) => !c.url.includes('bbox=')).length;
// Two bbox tiers: the viewport itself plus a regionally expanded box. An unbiased
// query is never issued because it returns worldwide noise.
check('small viewport issues a viewport and a regional query',
  withBbox === 2 && withoutBbox === 0, `bbox=${withBbox} unbiased=${withoutBbox}`);

const boxes = geocodeCalls()
  .map((c) => new URLSearchParams(c.url.split('?')[1]).get('bbox'))
  .filter((b): b is string => b !== null)
  .map((b) => b.split(',').map(Number));
const spans = boxes.map((b) => b[2] - b[0]).sort((a, b) => a - b);
check('the regional query covers a wider area than the viewport',
  spans.length === 2 && spans[1] > spans[0], spans.map((v) => v.toFixed(2)).join(' < '));

calls = [];
s().setViewport([-20, 10, 60, 70]); // continental span: "local" is meaningless
s().setSearchQuery('wide viewport');
await settleSearch();
check('oversized viewport skips bbox entirely',
  geocodeCalls().every((c) => !c.url.includes('bbox=')), `${geocodeCalls().length} calls`);
check('oversized viewport costs a single request', geocodeCalls().length === 1,
  `${geocodeCalls().length}`);

// Merge dedupes by mapbox_id across the two queries.
calls = [];
geocodeFeatures = [feature('dup', 'Same Place', 30.5, 50.45)];
s().setViewport([30.2, 50.2, 30.9, 50.6]);
s().setSearchQuery('dedupe me');
await settleSearch();
check('duplicate results merged once', s().searchResults.length === 1,
  `${s().searchResults.length}`);

// Direct client checks.
geocodeFeatures = [];
const empty = await searchPlaces('nothing', 'pk.test', {});
check('empty query result is an empty list', empty.length === 0);
const blank = await searchPlaces('   ', 'pk.test', {});
check('whitespace query short-circuits', blank.length === 0 && true);
check('GeocodingError is exported for callers', typeof GeocodingError === 'function');

report('search');
