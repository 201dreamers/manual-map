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
- Turf.js (`length`, `along`, `bearing`, `simplify`) for route math
- Web Wake Lock API to keep the screen awake during playback

The map fills the whole viewport and every control floats over it on a shared
translucent surface: a menu and the stop list in the top corners with distance and
ETA between them, playback at the bottom left, stepping at the bottom right and the
speed slider across the bottom. Current speed is read off the speed slider.

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

## Using the app

| Action | How |
|---|---|
| Build a route | Tap the map: first tap is the start, second the destination, further taps append waypoints (max 25 points). |
| Undo / reverse | In the top-left menu, together with Settings, History, Draw and Face north. |
| Reverse | Swaps start and destination, recalculates the road geometry, resets to 0 m. |
| Step | Floating back / forward buttons at the bottom right of the map. Forward (default 250 m) and backward (default 125 m) distances are configured independently in Settings and are clamped to both route ends. |
| Play | Floating play button; moves at the slider speed (0-180 km/h, km/h or mph display); pauses automatically at the route end. |
| Settings | Control mirroring, the forward and backward step distances, then the Mapbox token. |
| Mirror | Swaps the bottom-left playback cluster with the bottom-right step cluster for left-handed use; remembered across reloads. |
| Camera | Follows the vehicle heading-up. Dragging, zooming or rotating suspends tracking and shows a Recenter button; "Face north" in the menu rotates the map back to north-up. |
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
not. Rebuilds are picked up automatically on the next launch.

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
    format.ts              # distance, speed, ETA, coordinate formatting
    useAnimationLoop.ts    # rAF simulation loop
    useWakeLock.ts         # screen wake lock during playback
  store/simulationStore.ts # Zustand state, route building, step and playback logic
  components/              # map, HUD, controls, history drawer, settings, toasts
```

Not in V1 (see requirements.md): GPX import/export, landscape reflow, cross-device
route sync, custom HUD themes.
