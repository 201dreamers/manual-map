# Manual Map - Route Simulation and Tracking

A mobile-first web app for building driving routes on a Mapbox map and simulating
vehicle movement along them: discrete distance steps, a 0-180 km/h playback
simulation, heading-up map rotation, and live telemetry.

Built against [requirements.md](requirements.md) (V1 scope).

## Stack

- React 19 + TypeScript (strict) + Vite 8
- Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react` icons
- Zustand store with a `requestAnimationFrame` loop decoupled from the React tree
- Mapbox GL JS + Mapbox Directions API (`driving` profile)
- Mapbox traffic tileset for congestion, TomTom Traffic Incidents API v5 for hazards
- Turf.js (`length`, `along`, `bearing`, `simplify`) for route math
- Web Wake Lock API to keep the screen awake during playback

The map fills the whole viewport and every control floats over it on a shared
translucent surface. Menu, route lock and reset sit together in the top-left corner
with the zoom pair beneath them; the distance panel takes the top right, where it also
carries the stop count and opens the stop list. Speed stacks in the bottom-left column
and stepping in the bottom-right one, so neither thumb crosses the map. Speed and
playback share a single dial - a ring that fills with speed, play/pause in the middle
and the reading beneath it - with + and - buttons above.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: put your Mapbox public token here
npm run dev
```

Open the printed URL on a phone or in a mobile-sized browser window.

### Mapbox token

The app needs a Mapbox **public** token (`pk.*`). Tokens are resolved in this order:

1. Token saved in the in-app Settings modal (kept in `localStorage`)
2. `VITE_MAPBOX_ACCESS_TOKEN` from `.env.local`

Secret tokens (`sk.*`) are rejected in the UI. `.env` and `.env.local` are
gitignored - no token ever belongs in a commit.

### Traffic data coverage

Measured 2026-09-24: **TomTom and Mapbox both return no traffic data for Ukraine.** A
TomTom incidents query for the whole country returns `{"incidents":[]}` under HTTP 200,
while Amsterdam returns 226 and Warsaw 170; the Mapbox traffic tileset has no road
segments in Kyiv at any radius. Both vendors withdrew live traffic for Ukraine after
February 2022. The congestion and incident layers work correctly and will populate
elsewhere, but they are empty here.

The speed-camera layer comes from OpenStreetMap instead, which does have Ukrainian data
(28 cameras in central Kyiv), and needs no key.

### TomTom key (optional)

The incident overlay reads `VITE_TOMTOM_API_KEY` from `.env` / `.env.local`. It is
entirely optional: with no key the incident menu entries are not rendered, no request is
ever made, and every other feature behaves exactly as before.

Both keys are **inlined into the built bundle** by Vite, which is unavoidable for a
browser app with no server. Before deploying anywhere public, restrict the Mapbox token
by URL and the TomTom key by referrer in their respective consoles; the key in `.env` is
otherwise readable by anyone who loads the page.

## Using the app

| Action | How |
|---|---|
| Build a route | Tap the map: first tap is the start, second the destination, further taps append waypoints (max 25 points). |
| Undo / reverse | In the top-left menu, together with Settings, History, Draw and Face north. |
| Stops | Tap the distance panel to open the stop list; it carries the stop count. |
| My location | Toggles a blue marker showing where the device is, with an arrow for direction - GPS course while moving, compass at rest. It adds no stops and does not drive the cursor. The map flies to it on the first fix only. Once a route exists the button collapses to an icon; while the marker is on it shows a crossed icon, meaning the next press removes it. |
| Reverse | Swaps start and destination, recalculates the road geometry, resets to 0 m. |
| Step | Floating back / forward buttons at the bottom right of the map; the marker eases to the new position and repeated taps stack. Distance and glide length (default 700 ms) are configured per direction in Settings. Forward (default 250 m) and backward (default 125 m) distances are configured independently in Settings and are clamped to both route ends. |
| Play | Tap the speed dial; moves at the speed it reads (0-180 km/h, km/h or mph display); pauses automatically at the route end. |
| Speed | The + and - buttons above the dial move the speed by a configurable increment, +10 and -5 km/h by default. Tapping the dial itself plays or pauses. |
| Settings | The running build and an update check, control mirroring, the per-direction step distance and glide length, the per-direction speed increments, metric or imperial units, then the Mapbox token. |
| Mirror | Flips the whole interface for left-handed use - top controls and distance panel swap corners, the zoom pair follows the menu, both drawers open from the other side, and the thumb columns trade places; remembered across reloads. |
| Camera | Follows the vehicle heading-up. Dragging, zooming or rotating suspends tracking and shows a Recenter button; "Face north" in the menu rotates the map back to north-up. |
| Overlay defaults | Congestion and cameras are **on out of the box**: neither costs anything per use, since congestion rides the map tiles already being fetched and cameras come from keyless OpenStreetMap. TomTom incidents are metered against a daily quota, so that layer stays off until switched on. A layer switched off by hand stays off across reloads. |
| Traffic | Menu -> Show traffic paints live congestion over the roads, green through dark red. It comes from the Mapbox tileset the map already loads, so it costs no extra request and needs no second key. |
| Incidents | Menu -> Show incidents marks accidents, closures, road works and weather hazards from TomTom. Red is blocking, amber is slow, blue is weather. Needs `VITE_TOMTOM_API_KEY`; without one the menu entry is not shown and nothing else changes. |
| Refreshing | Incidents are fetched when the route is locked, or when Play locks it, then once every 30 minutes while it stays locked; cameras are fetched once per route. Rebuilding the route invalidates both. Menu -> Refresh traffic forces both by hand and is always offered, doing nothing for a layer that is off. Panning and zooming never fetch. |
| Cameras | Menu -> Show cameras marks speed cameras from OpenStreetMap along the route: a dark disc with a white ring, carrying the posted limit where OSM records one. No key needed, and it is the only hazard layer with data in Ukraine. Fetched once per route; Overpass being unavailable leaves the layer empty and is not reported. |
| History | Every calculated route is saved to `localStorage` and can be reloaded, deleted, or cleared from the side drawer. |

Playback is foreground-only: hiding the tab pauses the simulation.

## Installing on iOS

The app is a PWA, so it can be installed to the Home Screen and then runs from the
phone without the dev server.

1. Create a locally trusted certificate once (a service worker will not install over
   plain HTTP, so a LAN IP alone is not enough):
   ```bash
   brew install mkcert
   mkcert -install                       # adds a local CA to the system trust store
   mkdir -p certs && cd certs
   mkcert "$(hostname)" localhost 127.0.0.1 ::1
   mv *-key.pem local-key.pem && mv *.pem local.pem
   ```
   `certs/` is gitignored, and `vite.config.ts` serves over HTTPS whenever those two
   files exist - dev and preview both pick them up with no flags.
2. Trust the CA on the phone. AirDrop `rootCA.pem` from `mkcert -CAROOT`, install the
   profile under Settings -> General -> VPN & Device Management, then **enable full
   trust** under Settings -> General -> About -> Certificate Trust Settings. Skipping
   that last step leaves the certificate untrusted, and the service worker then never
   registers.
3. Build and serve:
   ```bash
   npm run build && npm run preview -- --host
   ```
4. Open the printed `https://<your-mac>.local:4173` URL in Safari, wait for the map to
   render, then Share -> **Add to Home Screen**.
5. Launch from the new icon. The app shell is precached, so it starts without the
   laptop and runs fullscreen with the notch and home-indicator insets applied.

The `.local` hostname is preferred over the IP because a new DHCP lease would change
the origin, and iOS treats a new origin as a different app: new service worker, empty
cache and no saved token. Rebuilding needs the Mac reachable again; everyday launching
does not.

Being a secure context, the installed app can also hold a **screen wake lock** during
playback, which plain-HTTP LAN access cannot.

**Map data still needs a connection.** Mapbox tiles, Directions and Geocoding are live
calls and are deliberately not cached, so the app shell works offline but the map does
not.

### Picking up a new build

An installed copy reloads itself as soon as an update check finds a new service worker.
iOS often restores a standalone app from its snapshot without navigating afresh, so the
check runs whenever the app returns to the foreground, and **Settings -> App -> Check
for updates** forces one by hand. The same section shows the build timestamp compiled
into the bundle, so a reload can be confirmed rather than assumed. Either way the Mac has to be serving the same origin at the
time; otherwise the cached build keeps running and the menu reports that the server
could not be reached.

## Scripts

```bash
npm run dev       # dev server
npm run build     # type-check (tsc -b) and production build
npm run lint      # oxlint
npm test          # headless suites (live Mapbox suite runs when a token is present)
npm run preview   # serve the production build
```

## Source layout

```
src/
  types/domain.ts          # core domain interfaces
  lib/
    geo.ts                 # Turf route geometry: length, along, bearing, simplify
    directions.ts          # Mapbox Directions API client
    storage.ts             # typed localStorage repositories
    token.ts               # token resolution and pk./sk. validation
    errors.ts              # the boundary between what failed and what the driver is told
    format.ts              # distance, speed, ETA, coordinate formatting
    traffic.ts             # TomTom incidents: fetch policy, parsing, GeoJSON for the layers
    cameras.ts             # OSM speed cameras over Overpass: corridor query, parsing, mirrors
    geolocation.ts         # device position watch and GPS/compass heading handover
    useAnimationLoop.ts    # rAF simulation loop
    useWakeLock.ts         # screen wake lock during playback
  store/simulationStore.ts # Zustand state, route building, step and playback logic
  components/              # map, HUD, controls, history drawer, settings, toasts
```

Not in V1 (see requirements.md): GPX import/export, landscape reflow, cross-device
route sync, custom HUD themes.
