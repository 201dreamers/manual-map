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
| Undo / clear | Undo and clear buttons in the top bar. |
| Reverse | Swaps start and destination, recalculates the road geometry, resets to 0 m. |
| Step | `-` / `+` buttons move by the configured step distance (default 500 m), clamped to both route ends. |
| Play | Moves at the slider speed (0-180 km/h, km/h or mph display); pauses automatically at the route end. |
| Camera | Follows the vehicle heading-up. Dragging, zooming or rotating suspends tracking and shows a Recenter button. |
| History | Every calculated route is saved to `localStorage` and can be reloaded, deleted, or cleared from the side drawer. |

Playback is foreground-only: hiding the tab pauses the simulation.

## Scripts

```bash
npm run dev       # dev server
npm run build     # type-check (tsc -b) and production build
npm run lint      # oxlint
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
