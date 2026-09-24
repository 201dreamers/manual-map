# Requirements Document: Route Simulation and Tracking Web Application

**Document File Name:** requirements.md  
**Status:** Finalized Specifications (TypeScript + Zustand + Tailwind CSS Architecture)  
**Target Platform:** Web Application (iOS Safari & Mobile Browsers - Portrait First)  

---

## 1. Project Overview & V1 vs V2 Scope

The Route Simulation and Tracking Web Application provides an interactive web interface to build driving routes and simulate vehicle movement along geographic paths. Users can step forward or backward in exact distance increments or run an automated drive simulation with real-time speed controls, dynamic map rotation, and camera tracking.

### Scope Split

| Feature Category | Version 1.0 (Initial Release) | Version 2.0 (Post-Launch) |
|---|---|---|
| **Route Source** | Interactive Mapbox route builder (Start, Destination, Waypoints). | Freehand draw-to-splice, planning drawer with reorder, address search (see Part II). GPX import/export deferred further. |
| **Viewport Support** | Mobile Portrait view (iOS Safari optimization). | Landscape auto-reflow for horizontal car dash mounts. |
| **Route Persistence** | Local route history list in `localStorage` with deletion/cleanup tools. | Syncing routes across devices or user accounts. |
| **Styling & UI** | Tailwind CSS v4 responsive mobile-first HUD layout with Lucide icons. | User-customizable HUD themes and color palettes. |

---

## 2. Target Audience & Core Use Cases

### Target Audience
* Field testing engineers and developers evaluating location-aware software behavior.
* Logistics drivers previewing routes and distance milestones before driving.
* Users running simulated drives to inspect road geometry and calculated ETAs.

### Primary Use Cases
* **Interactive Route Planning:** Tap locations on the map to calculate turn-by-turn driving paths using real road networks.
* **Discrete Step Movement:** Advance or rewind position by configurable increments (default 500m) to inspect turns and checkpoints.
* **Automated Heading-Up Simulation:** Set a speed (0 to 180 km/h) and watch the map rotate dynamically so the marker always points up towards the top of the phone screen.

---

## 3. Non-Functional Requirements & Platform Constraints

| Requirement | Specification Details |
|---|---|
| **Target Browsers** | Safari on iOS (iOS 15+ focus) and modern mobile/desktop web browsers. |
| **Orientation (V1)** | Portrait viewport optimization. Responsive layout targeting standard iPhone dimensions. |
| **Touch Ergonomics** | Minimum 44x44px touch target sizes for primary buttons to satisfy iOS Safari mobile guidelines. |
| **Screen Persistence** | **Web Wake Lock API integration**: Prevents the iPhone display from dimming or sleeping during active playback. Requires a secure context, so it is active when installed as a PWA or served over HTTPS, and absent over plain-HTTP LAN access. |
| **Map Rendering** | 60 FPS vector map rendering and rotation using WebGL via Mapbox GL JS. |
| **Performance Safeguard** | Large coordinate arrays returned from APIs are automatically downsampled using Turf.js simplify algorithms to maintain high frame rates on mobile GPUs. |
| **Execution Context** | Foreground web tab execution. Simulation pauses if the browser tab is hidden or minimized. |
| **Installability** | Installable PWA (`vite-plugin-pwa`, Workbox `generateSW`). The app shell is precached so an installed copy launches without a dev server; Mapbox tiles and API responses are deliberately not cached, as their terms restrict offline storage and stale routing data would mislead. Workbox's default 2 MiB precache ceiling is raised, since the app bundle exceeds it. |
| **Repository & Deployment** | **Strictly local work:** Local Git repository only (`main` branch). No remote repository configured; zero remote push operations. |
| **Secrets & Credential Security** | **Zero-secret repository policy:** Passwords, API tokens, and secret keys must never be committed to Git or hardcoded in client source files. All sensitive environment files (`.env`, `.env.local`) are strictly gitignored. Safe template provided via `.env.example`. |

---

## 4. Functional Requirements

### 4.1 Route Building & Reversal
* **FR-1.1 Map Tapping:** Users can tap the map to define a Start Point and Destination Point. Intermediate waypoints can be added.
* **FR-1.2 Driving Route Generation:** The system sends route waypoints to the Mapbox Directions API (`driving` profile) to fetch road geometry.
* **FR-1.3 Route Failure Handling:** If no valid driving route is found between points (e.g., across water or restricted roads), the app shows an explicit error notification ("Unable to calculate road route between selected points") and clears the invalid segment.
* **FR-1.4 Route Reversal:** A dedicated "Reverse Route" control swaps Start and Destination points, recalculating geometry and resetting the marker to 0 meters.

### 4.2 Step Controls & Boundary Rules
* **FR-2.1 Step Controls:** UI buttons for `- Step` and `+ Step`.
* **FR-2.2 Configurable Step Distance:** Forward and backward step distances are configured independently (defaults: 250 m forward, 125 m backward). Both are edited in the Settings modal (e.g., 125m, 250m, 500m, 1000m).
* **FR-2.3 Polyline Interpolation:** Positional jumps snap to precise points along the road path geometry using Turf.js spatial interpolation math (`turf.along`).
* **FR-2.4 Upper Boundary Clamp:** If `+ Step` exceeds total route length, the marker clamps strictly to 100% (route end) and active playback pauses.
* **FR-2.5 Lower Boundary Clamp:** If `- Step` drops below 0 meters, the marker clamps strictly to 0m (route start).

### 4.3 Speed Simulation & Animation Logic
* **FR-3.1 Speed Slider:** Real-time adjustable slider ranging from 0 km/h to 180 km/h (with km/h and mph toggle).
* **FR-3.2 Dynamic Speed Updates:** Adjusting the speed slider during active playback recalculates the distance delta seamlessly on the next animation tick without visual stutter.
* **FR-3.3 Time Discarding:** Any imported or calculated timestamps are ignored. Movement speed is strictly driven by the UI speed controller.
* **FR-3.4 Playback Triggers:** Controls for `Play`, `Pause`, and `Reset to Start`.

### 4.4 Map Camera & Heading-Up Rotation
* **FR-4.1 Heading-Up Map Rotation:** As the marker moves along the route, the map rotates continuously so the vehicle bearing points directly toward the top of the mobile screen.
* **FR-4.2 Continuous Auto-Centering:** The map camera stays centered on the vehicle marker during automated playback. Pressing Play engages tracking; building or editing a route never moves the camera, and offers the Recenter control instead.
* **FR-4.2a Compass / North Reset:** A compass control rotates the map back to north-up. It releases heading-up tracking at the same time, since otherwise the next playback frame would rotate the map away again; Recenter restores heading-up following.
* **FR-4.3 Manual Drag Override:** If the user manually drags or zooms the map during playback, camera auto-centering and rotation temporarily disable. A floating "Recenter" button appears to allow the user to re-enable camera tracking.

### 4.5 Telemetry & History Management
* **FR-5.1 Live Dashboard Display:** A single compact card floating over the map:
  * Distance Covered vs. Total Route Distance
  * Estimated Time to Arrival (ETA calculated at current speed setting)
  * Current Speed (km/h or mph) - shown on the speed slider, not duplicated here
  * **Removed by request:** Distance Remaining (derivable from the distance pair) and the live latitude/longitude readout (the marker already shows position). Both remain in `TelemetryState` because the ETA calculation and the map marker depend on them.
* **FR-5.2 Saved Routes History:** Generated routes are stored locally in `localStorage`.
* **FR-5.3 History Manager:** A side drawer list displays saved routes with details (Name, Creation Date, Distance) and options to load or delete individual entries or clear all history.

### 4.6 Token Management & Security
* **FR-6.1 Dual-Source Token Resolution:** The Mapbox access token is resolved with the following priority:
  1. Token entered and saved in the in-app Settings modal (`localStorage`).
  2. Environment variable `VITE_MAPBOX_ACCESS_TOKEN` loaded from local `.env.local`.
* **FR-6.2 Token Scope Restriction:** Only Mapbox **Public Tokens** (`pk.*`) are accepted. Public scopes (`STYLES:TILES`, `STYLES:READ`, `FONTS:READ`, `DATASETS:READ`) are utilized. Secret tokens (`sk.*`) and secret scopes are strictly rejected in the UI to protect user credentials.
* **FR-6.3 In-App Token Configuration:** If no token is detected upon launch, an initial setup modal prompts the user to enter their public token before initializing map features. A persistent settings button in the top bar allows updating or clearing the token anytime.

---

## 5. UI/UX Viewport Layout Specification

```
+---------------------------------------------------------+
| (Hist) (Set)              (Undo) (Stops 3) (Rev)        |  <- Floating action buttons
| [ Tap the map to set a start point ]                    |  <- Status pill (only when useful)
| [ 15.2/45.0 km | ETA 29 min ]                           |  <- Floating telemetry card
|                                                         |
|                                                         |
|                     MAP VIEWPORT                        |  <- Full-bleed Mapbox Vector Map
|                   (Always Rotating)                     |
|                                                         |
|                          ( ^ )                          |  <- Fixed Vehicle Marker (Points UP)
|                                                         |
|                 [ Recenter Camera ]                     |  <- Appears only after manual pan
|                                                         |
|  [ -125m ]     [ |< ] ( PLAY )              [ +250m ]   |  <- Floating step & playback controls
|  [ ==========|---------------- ]   60  [ km/h ]         |  <- Floating speed slider (0-180 km/h)
+---------------------------------------------------------+
```

* **Touch Ergonomics:** All buttons have a minimum hit target of `min-h-[44px]` with clear tactile/visual pressed states for mobile Safari.
* **Safe Area Support:** The floating top stack and bottom controls account for the iOS notch (`env(safe-area-inset-top)`) and home indicator (`env(safe-area-inset-bottom)`).
* **Full-bleed Map:** No control occupies a solid strip of the viewport. Actions, status, telemetry and playback controls all float above the map on the shared translucent surface.

---

## 6. Technical Stack, Core Mechanics & Type Definitions

### 6.1 Tech Stack
* **Language & Runtime:** TypeScript (Strict Mode) with React 19 + Vite 8.
* **Styling:** **Tailwind CSS v4** via `@tailwindcss/vite` (mobile-first responsive utility styling).
* **Icons:** `lucide-react` for crisp SVG icons.
* **State Management:** **Zustand** store for global simulation state:
  * High-frequency 60 FPS animation loop decoupled from React component tree re-renders.
  * Fine-grained component subscriptions (`useSimulationStore(s => s.telemetry)`).
  * Direct imperative access in `requestAnimationFrame` ticks (`useSimulationStore.getState()`).
* **Map Renderer:** Mapbox GL JS (`mapbox-gl`) with `@types/mapbox-gl`.
* **Routing Engine:** Mapbox Directions API (`driving` profile).
* **Spatial Calculations:** `@turf/turf` (Turf.js with native TS support):
  * `turf.length` - Calculates total route length.
  * `turf.along` - Computes exact coordinate at distance offset.
  * `turf.bearing` - Calculates heading angle for map rotation.
  * `turf.simplify` - Downsamples geometry for mobile GPUs.
* **Screen Keep-Awake:** Web `navigator.wakeLock` API with TypeScript type declarations.
* **Local Persistence:** Typed `localStorage` repository for saved routes and user settings.
* **Secret Hygiene:** Ignored `.env*` files via `.gitignore`; non-secret [.env.example](file:///Users/dhakman/local/repos/manual-map/.env.example) template provided.

### 6.2 Core Domain Interfaces (TypeScript)

```typescript
export type CoordinateTuple = [number, number]; // [longitude, latitude]

export interface RouteMetadata {
  id: string;
  title: string;
  createdAt: string; // ISO timestamp
  totalDistanceMeters: number;
  coordinates: CoordinateTuple[];
}

export interface TelemetryState {
  currentDistanceMeters: number;
  currentSpeedKmh: number;
  remainingDistanceMeters: number;
  etaSeconds: number;
  currentCoordinate: CoordinateTuple | null;
  bearingDegrees: number;
}

export interface SimulationConfig {
  stepForwardMeters: number; // default 250
  stepBackMeters: number; // default 125
  speedKmh: number; // range 0 - 180
  speedUnit: 'kmh' | 'mph';
  isPlaying: boolean;
  cameraTrackingEnabled: boolean;
}

export interface AppSettings {
  mapboxAccessToken: string | null;
}
```

### 6.3 Frame-by-Frame Animation Math
On every `requestAnimationFrame` tick during active simulation:
1. `time_delta = current_time - last_tick_time`
2. `distance_delta = (speed_in_kmh / 3.6) * time_delta_seconds`
3. `new_distance = current_distance + distance_delta`
4. If `new_distance >= total_route_length`: Clamp to `total_route_length`, set state to Paused.
5. Extract coordinate using `turf.along(route_line, new_distance)`.
6. Calculate target bearing using `turf.bearing(current_coord, next_coord)`.
7. Rotate map canvas to `-bearing` degrees so vehicle points up on screen.

---

# Part II - Version 2: Draw, Plan & Search

**Status:** Approved specification (planning session). Part I above describes the shipped V1 application.

**Goal:** Build a route by sketching on the map, editing an ordered stop list, or searching addresses - with a drawn stroke reshaping only the part of the route it spans.

## 7. Locked Decisions

| # | Decision |
|---|---|
| D-1 | A stroke **splices only the span it covers**; start and end stay pinned. |
| D-2 | Planning is an **inline drawer** over the live map - no separate mode. |
| D-3 | A search result opens a **chooser**: Set start / + Via / Set end. |
| D-4 | History is written on the **first Play press**; later edits update the same entry. |
| D-5 | A far stroke **splices anyway**, with **undo** to revert. |

## 8. Constraints

* Mapbox Directions accepts **max 25 coordinates** per request. This is the hard ceiling on the whole design.
* Public `pk.*` tokens only; secrets never committed. Local git, `main`, no remote.
* Mobile portrait / iOS Safari; 44px minimum touch targets; 60 FPS during playback.
* Minimal dependencies - no drag-and-drop library without an explicit decision.
* TypeScript strict; `tsc -b` and `oxlint` must stay clean.

## 9. Glossary

* **Waypoint** - a user-placed point. `W0` = start, `Wn` = end, the rest are **vias**.
* **Stroke** - the raw freehand polyline drawn by the user.
* **Entry / exit** - the stroke's two ends projected onto the existing route line.
* **Span** - route distance between entry and exit; the only part a splice replaces.
* **Draft** - a built route that has not yet been driven, so not yet in history.
* **Commit** - the first Play press on a draft.

## 10. V2 Scope

### 10.1 In Scope

**Foundations (Phase 1)**
* `RoutePoint` gains `label?: string`; `RouteMetadata` gains optional `waypoints` and `updatedAt`.
* Save-on-commit replaces save-on-every-recalculation.
* A general undo stack (depth 10) covering add / delete / reorder / splice, replacing `undoLastPoint`.

**Planning drawer (Phase 2)**
* Ordered stop list with label + role (Start / Via N / End), add, delete, reorder.
* Reorder and delete trigger a debounced recalculation.
* Loading a saved route restores its **waypoints**, so it stays editable.

**Search (Phase 3)**
* Mapbox Geocoding v6 forward, debounced 300 ms, min 3 chars, viewport + regional `bbox` biasing (see AC-305), aborting in-flight requests.
* Result chooser: Set start / + Via (inserted before the end) / Set end.

**Draw-to-splice (Phase 4)**
* A pen toggle arms drawing; map pan/zoom/rotate disable for the stroke, then re-enable and auto-disarm.
* Live dashed stroke overlay while drawing.
* Empty map -> stroke becomes a new route. Existing route -> stroke splices its span.
* Undo control after every splice.

### 10.2 Out of Scope (deferred)

Drag-and-drop reordering (see A-2), multi-profile routing (walking/cycling), reverse geocoding of tapped pins, route naming/renaming, GPX, landscape, cross-device sync, offline search caching, alternate-route suggestions.

## 11. Assumptions To Confirm

| # | Assumption | Flip cost |
|---|---|---|
| A-1 | Stroke samples become **Directions via-points**, not Map Matching input. Map Matching caps `radiuses` at 50 m; a finger stroke at zoom 12 (~38 m/px) is routinely 200 m+ off-road, so it would return `NoSegment` on rough sketches. Via-points have no distance cap. Both endpoints verified working against the project token. | Low - isolated in one module |
| A-2 | Reorder is **up/down arrow buttons**, not drag-and-drop, honouring the minimal-dependency rule. Touch DnD is ~100 lines of pointer-event code, or ~30 KB for dnd-kit. | Medium - UI only |
| A-3 | Map-tapped points are labelled `Dropped pin (lat, lng)`; only searched points get real names. | Low |
| A-4 | Stroke sampling budget is **6 via-points max**. | Low |
| A-5 | Undo is in-memory only - not persisted across reload. | Low |

## 12. Waypoint Budget (binding constraint)

```
25 total  -  2 (start + end)  -  2 (entry + exit)  -  keptVias  =  stroke budget
```

Capped at 6 samples. If `keptVias > 19`, the splice is refused with an explicit message rather than a silent truncation.

## 13. Splice Algorithm

1. Project stroke ends onto the route via `nearestPointOnLine` -> `entryDist`, `exitDist`.
2. If `entryDist > exitDist`, reverse the stroke - the user drew it backwards.
3. Keep vias outside the span; drop those inside it.
4. Simplify the stroke, then sample evenly by distance to the budget.
5. Rebuild: `[W0, ...keptBefore, entry, ...samples, exit, ...keptAfter, Wn]`.
6. Drop any two consecutive waypoints closer than 10 m.

## 14. Acceptance Criteria

### Foundations
* **AC-101** *(Required)* - Route built, never played -> history unchanged. Press Play -> exactly one entry appears. Edit a stop, press Play again -> still one entry, `updatedAt` advanced. *Verify: headless store harness.*
* **AC-102** *(Required)* - Save a route with 2 vias, reload, load it from history -> the drawer shows 4 stops in original order with labels, not 2 endpoints. *Verify: headless harness.*
* **AC-103** *(Required)* - A saved route stored before this change (no `waypoints` field) still loads and simulates, falling back to endpoint reconstruction. Must not throw or drop the entry. *Verify: harness with a legacy fixture.*
* **AC-104** *(Required)* - After a splice, Undo restores the exact previous waypoint list and geometry. Ten successive operations are individually undoable. *Verify: headless harness.*

### Planning drawer
* **AC-201** *(Required)* - Route A->B, add a via, move it above the start -> recalculation fires once (debounced), list order matches the map, total distance changes. *Verify: harness + manual.*
* **AC-202** *(Required)* - Delete the only via -> route returns to a direct A->B path; deleting down to one stop clears geometry without error. *Verify: headless harness.*
* **AC-203** *(Important)* - The drawer does not block the step, play or speed controls while open. *Verify: manual on device (human judgment).*

### Search
* **AC-301** *(Required)* - Typing 3+ chars issues one request after 300 ms idle; typing again aborts the in-flight request. Rapid typing never leaves results out of order. *Verify: harness with a stubbed fetch counting calls/aborts.*
* **AC-302** *(Required)* - Selecting a result with "Set start" replaces `W0` and keeps all other stops and their order. "+ Via" inserts immediately before the end. *Verify: headless harness.*
* **AC-303** *(Required)* - A searched stop shows its address label in the drawer and in the generated route title (e.g. `Khreshchatyk 1 -> Boryspil Airport`). *Verify: headless harness.*
* **AC-304** *(Required)* - Geocoding 401/403 shows "Mapbox rejected the access token. Check it in Settings." and does not clear the route. *Verify: harness with stubbed 401.*
* **AC-305** *(Important)* **[revised]** - Searching a street name with the map centred on Kyiv returns Kyiv matches in the top 3, and places just off-screen (a nearby airport) remain findable. *Verify: live API call.*
  * **Constraint found:** measured against the live API, `proximity` does not affect ranking at all, and `country` / `types` change nothing. Only `bbox` ranks correctly, but it *restricts* rather than biases. An unbiased query is worse still: "Boryspil International Airport" returns a street in Tennessee.
  * **Resolution:** two `bbox` queries run in parallel - the viewport, and a regionally expanded box (8x, capped at 6 degrees) - merged nearest-first and deduped by `mapbox_id`.
  * **Scope cut:** search is therefore **regional, not global**. To find somewhere distant, pan the map there first. Worldwide relevance is not achievable with this API without a country hint the app does not have.

### Draw-to-splice
* **AC-401** *(Required)* - With drawing armed, a drag draws a stroke and the map does not pan; on release, gestures are restored and the pen disarms. *Verify: manual on device - not reproducible headlessly.*
* **AC-402** *(Required)* - Empty map + stroke -> a drivable route whose ends are near the stroke's ends. *Verify: live-API harness.*
* **AC-403** *(Required)* - Route A->B + stroke across the middle -> A and B unchanged (within 10 m), and geometry between entry and exit differs from before. *Verify: live-API harness.*
* **AC-404** *(Required)* - A stroke drawn end-to-start splices identically to one drawn start-to-end. *Verify: headless harness.*
* **AC-405** *(Required)* - A route with 20 vias + stroke -> refused with "Too many stops to reshape this route" rather than exceeding 25 coordinates. *Verify: headless harness.*
* **AC-406** *(Important)* - A 300-point stroke is reduced to <=6 via-points before the request. *Verify: headless harness.*

## 15. Failure Behavior

| Situation | Expected |
|---|---|
| Stroke shorter than 25 m of ground distance (a tap) | Ignore silently, disarm pen, route untouched |
| Stroke of fewer than 2 distinct points | Ignore silently |
| Splice would exceed 25 coordinates | Refuse with explicit message; route untouched |
| Directions returns `NoRoute` after a splice | Restore previous route, show existing FR-1.3 message |
| Stroke far from route | Splice anyway (D-5); Undo available |
| Geocoding returns zero results | "No places found" empty state; route untouched |
| Viewport wider than 2 degrees | Skip bbox biasing; issue one unbiased query |
| One of the two bbox queries fails | Use the other; surface an error only if both fail |
| Geocoding 429 | "Search rate limit reached. Try again in a moment."; no route change |
| Geocoding network failure | Inline retry in the results panel; route untouched |
| Reorder during active playback | Pause playback, recalculate, reset position to 0 m |
| Delete a stop leaving fewer than 2 | Clear geometry, keep remaining stop, no error toast |
| Legacy saved route without `waypoints` | Load read-only via endpoint fallback; editing re-derives stops |
| Undo pressed with empty stack | Control hidden/disabled - never a no-op tap |

## 16. Phases

1. **Foundations** - labels, schema + back-compat, save-on-commit, undo stack. Nothing else is safe to build first. AC-101..104.
2. **Planning drawer** - list, add, delete, reorder. AC-201..203.
3. **Search** - geocoding client, panel, chooser, title generation. AC-301..305.
4. **Draw-to-splice** - gesture capture, projection math, budget, splice. Riskiest; depends on 1 and 2. AC-401..406.

Phases 2 and 3 may swap; 1 must be first and 4 last.

## 17. Verify

```bash
npm run build          # tsc -b strict + vite build
npm run lint           # oxlint
# headless harness (existing pattern): vite ssr build -> node
# live-API harness gated on MB_TOKEN
```

Existing suites that must stay green: geo math (14), store logic (26), token validation (8), step defaults (11).

## 17a. Implementation Notes (Phase 4)

* Stroke samples are fed to the Directions API as via-points (A-1 confirmed). Map Matching was not used: its `radiuses` cap of 50 m is below the accuracy of a finger stroke.
* A splice returns bare coordinates, so surviving stops are matched back to the originals to keep their searched labels. The pinned start and end are matched **by position**, not proximity - a stroke whose ends project onto the route end would otherwise steal the destination's identity.
* The tap threshold is metric (25 m of ground distance) rather than pixels, so it behaves consistently at every zoom level.

## 18. Known Risks

* **Gestures and reordering cannot be verified headlessly** - no browser in the build environment. AC-203 and AC-401 require on-device testing.
* **The 25-coordinate ceiling** is the sharpest edge: a heavily-via'd route plus a stroke hits it. AC-405 pins the behavior.
* **AC-305 is a known current failure**, not hypothetical - search relevance needs real tuning work.
* **Splice on a self-intersecting route** (a loop crossing itself) can project entry/exit ambiguously. Not covered in V2.

---

# Part III - Version 3: Driving Ergonomics, Route Lock & Look-Ahead

**Status:** Approved specification (planning session). Parts I and II above describe the shipped V1 and V2 application.

**Goal:** Make the app usable one-thumb while driving - bigger targets, no accidental point adds, the cursor repositionable by map tap, and the road ahead visible without losing camera lock.

## 19. Locked Decisions

| # | Decision |
|---|---|
| D-1 | Baseline controls grow to ~72px. **Lock is the mode switch**: locked means the 88px stripped Drive layout, unlocked means the normal layout. One concept, not two. |
| D-2 | Lock engages automatically on Play, and by manual toggle at any time. |
| D-3 | Lock blocks map-tap point adds, draw-line mode, and Undo / Reverse / Clear. It does **not** block Plan drawer edits (reorder, rename, delete). |
| D-4 | While locked, a map tap within 44px on screen of the route line moves the cursor to that point. A tap further away is ignored with a toast. |
| D-5 | Moving the cursor during playback keeps playing from the new point. |
| D-6 **[revised; slider superseded by D-28; ETA dropped by D-52]** | The speed row stays visible in the Drive layout. Reset-to-start and the status pill hide. **Distance and ETA stay visible**: they are the numbers the drive is about, and the status pill only ever carries planning hints. |
| D-7 | Zoom out gets both: large +/- buttons in the cluster, and pinch that no longer breaks camera tracking. |
| D-8 | The menu button stays visible while locked, with its route-mutating items disabled. Hiding it would strand Settings and History behind an unlock. |
| D-9 **[revised; mirroring superseded by D-54]** | The zoom +/- pair is a vertical stack in the **top-left corner**, under the menu. It does not mirror: `controlsMirrored` swaps the two bottom thumb clusters and the zoom pair is no longer one of them. It hides while the menu is open, which drops into the same corner. |
| D-10 | The lock lives in the **top action row**, beside the stop count, at the 48px row size rather than a Drive target. A top-corner control cannot be 88px without eating the map. |
| D-11 | Recentring is floated in the empty middle of the button row, level with play and above the speed slider. The thumb columns sit at the edges, so it costs no layout shift when it appears. |
| D-12 | A tapped move **glides** on the step easing rather than teleporting. Unlike a step, it never pauses playback. |
| D-13 | The followed vehicle sits at 0.75 of container height, with at least 200px kept below it. On a short screen the clearance wins and the anchor gives way, or the marker would sit behind the floating controls. |
| D-14 | A lock cannot outlive the route it guards: dropping below two stops releases it, and a standing lock is never disabled. |

**Accepted consequence of D-1 + D-2:** because Lock is the layout switch and Play auto-locks, pressing Play always enters the stripped Drive layout. A route cannot be locked while keeping the planning layout. This was chosen deliberately in favour of a single concept.

## 20. Constraints

* No control may occupy a solid strip of the viewport (section 5 remains binding). Everything floats on the shared `GLASS_SURFACE`.
* `min-h-[44px]` stays the floor, not the goal: normal targets are ~72px, Drive targets 88px.
* Safe-area insets, top and bottom, stay respected.
* Zero new dependencies. Projection reuses turf `nearestPointOnLine`, already imported by `src/lib/splice.ts`.
* TypeScript strict; `tsc -b` and `oxlint` must stay clean.
* No browser or device exists in the build environment, so every ergonomic criterion below is marked human-verify and must be reported as unverified rather than claimed.

## 21. Glossary

* **Locked** - the route is immutable from the map, the Drive layout is active, and map taps move the cursor.
* **Cursor** - the vehicle marker's position along the route, i.e. `telemetry.currentDistanceMeters`.
* **Drive layout** - 88px controls; telemetry, reset and status pill hidden; speed slider kept.

## 22. V3 Scope

### 22.1 In Scope

* `isRouteLocked` state, held for the session only.
* Lock gating inside `addRoutePoint`, `setDrawArmed`, `undo`, `reverseRoute` and `clearRoute`.
* A lock button in the bottom cluster: 88px while locked, 72px while not.
* Two layouts driven off `isRouteLocked` in `ControlPanel` and `TopBar`.
* `projectOntoRoute()` promoted into `src/lib/geo.ts` and shared with the private `projectOnto` in `splice.ts`.
* Tap-to-move-cursor with a screen-space proximity gate, wired to the existing `applyDistance()`.
* Zoom +/- buttons; `zoomstart` removed from the tracking-kill list; `touchZoomRotate.disableRotation()` while tracking.

### 22.2 Out of Scope (deferred)

* Voice control and hardware-button control.
* Persisting the lock state across app restarts.
* Haptic feedback on lock and unlock.
* Any Android-specific work.
* Auto-unlock heuristics, such as unlocking on arrival at the destination.

## 23. Acceptance Criteria

### Lock core

* **AC-501 Lock blocks map-tap adds.** Route with two or more stops, unlocked. Press Lock, then tap empty map away from the route. Expected: the stop count is unchanged and no Directions request is fired. Must not: swallow the tap without feedback. Verify: store-level automated test plus a human map check. Required.
* **AC-502 Play auto-locks.** Unlocked route, cursor at 0. Press Play. Expected: `isRouteLocked` becomes true and the Drive layout renders in the same frame. Verify: automated store test. Required.
* **AC-503 Locked gates the mutating menu items.** Locked. Open the menu. Expected: Undo, Reverse route and Draw line are disabled, while Settings, History and Face north stay usable. Must not: disable Plan drawer reorder or delete. Verify: automated assertion on `disabled` plus a human check. Required.

### Drive layout

* **AC-504 Drive layout target sizes [revised three times].** Locked, route loaded. Expected: both step buttons and the speed +/- pair each measure at least 88px in both axes - four targets - and the speed dial is larger still at 112px. Play is no longer counted separately, having merged into the dial (D-31); reset-to-start and the status pill are absent; the speed row, the distance/ETA card, the menu and the stop list are present. The lock is excluded from the 88px rule by D-10, the telemetry from the hiding rule by D-6. Verify: automated class assertion against a rendered tree; the feel is human-judgment. Required.
* **AC-505 Normal layout target sizes [revised three times].** Unlocked. Expected: both step buttons and the speed +/- pair each measure at least 72px - four targets - with the speed dial at 96px; telemetry, reset and the status pill are present; the lock is offered from the top row. Verify: as AC-504. Required.
* **AC-506 Recenter is laid out, not offset [revised].** Camera panned by hand. Expected: Recenter appears centred above the speed slider, at least 56px tall, positioned by the control panel rather than by any bottom offset, and its arrival leaves the thumb cluster byte-identical. Constraint that forced the change: a hardcoded offset had to be re-derived every time the cluster changed height, and it changed four times. Removing the constant removes the class of bug. Verify: rendered-tree comparison with and without it. Required.

### Tap-to-move

* **AC-507 Tap near the route moves the cursor.** Locked, route loaded, cursor at 0 m. Tap the drawn route line near its midpoint. Expected: the vehicle marker jumps to that point, the telemetry distance matches the projected value within 25 m, and camera tracking stays engaged. Must not: add a stop or alter the geometry. Verify: automated tests for `projectOntoRoute` and the store; marker behaviour human-verify. Required.
* **AC-508 Tap far from the route is refused.** Locked. Tap empty map more than 44px from the line. Expected: the cursor is unchanged, one toast appears, and no stop is added. Verify: automated store test plus a human check. Required.
* **AC-509 Moving the cursor during playback keeps playing.** Locked and playing at 60 km/h. Tap ahead on the route. Expected: the cursor jumps, `isPlaying` stays true, and motion resumes from the new distance at the same speed. Verify: automated store test. Required.

### Look-ahead zoom

* **AC-510 Zoom buttons keep the camera centred [revised].** Tracking on, zoom 16, **whether playing or paused**. Press minus three times. Expected: zoom drops one level per press, the vehicle holds its anchor, tracking stays enabled and heading-up rotation continues. The paused case is called out because it failed differently from the playing one; see section 25a. Verify: automated easing and store tests plus source guards; visual smoothness human-verify. Required.
* **AC-511 Pinch no longer drops tracking.** Tracking on. Pinch to zoom out. Expected: the zoom changes, tracking stays enabled, the map does not rotate away from heading-up, and the new zoom persists across later tracking frames. Must not: leave rotation enabled for the pinch gesture while tracking. Verify: human-verify on device, since no touch emulation exists here, plus an automated assertion that `zoomstart` is not bound to the tracking-kill handler. Required.
* **AC-512 Drag still drops tracking.** Tracking on. Drag the map. Expected: tracking disables and Recenter appears, exactly as FR-4.3 specifies today. Verify: existing behaviour must not regress; human check. Required.

## 24. Failure Behavior

| Situation | Expected |
|-----------|----------|
| Tap to move the cursor with no route loaded | Ignore; the lock is not offered without a route |
| Tap more than 44px from the route while locked | Ignore, plus an info toast: "Tap the route to move the marker" |
| Lock pressed with fewer than two stops | Lock button disabled; there is nothing to protect |
| Play pressed while already locked | No change to the lock; playback starts normally |
| Unlock pressed while playing | Playback continues; the layout returns to normal; edits are re-enabled |
| Zoom minus at the Mapbox minimum zoom | Clamp silently, no toast |
| `nearestPointOnLine` returns no `location` | Treat as a miss, exactly like a far tap. Never fall back to 0 m, which would teleport the cursor to the start |
| Draw arm attempted while locked | Menu item disabled; a programmatic call is a no-op |
| Route falls below two stops while locked | The lock is released by the same write that shortens the route (D-14) |
| Lock pressed while the route is empty | Disabled, unless the lock is already on, which must always be releasable |
| Menu opened over the zoom stack | The zoom stack hides for as long as the menu is open |
| Container too short for the vehicle anchor | Clearance wins over the anchor; below twice the clearance it falls back to centre |

## 25. Phases

1. **Lock core** - state, gating, auto-lock on Play, lock button. Everything else gates on it. AC-501..503.
2. **Drive layout** - size tokens, conditional layout, Recenter placement. AC-504..506.
3. **Tap-to-move** - `projectOntoRoute` into `geo.ts`, the screen-space gate in `MapView`, wiring to `applyDistance`. AC-507..509.
4. **Look-ahead zoom** - buttons, `zoomstart` unbinding, rotation suppression, zoom ownership. AC-510..512.

Phase 1 must be first. Phase 4 is independent of 1 to 3 and may run at any point.

## 25a. Implementation Notes

* **The tap threshold here is screen-space (44px), deliberately diverging from section 17a**, where the draw-tap threshold is metric (25 m) for zoom consistency. The reason for the difference: a finger is a fixed physical size, so a miss threshold aimed at finger accuracy should be too, and a 25 m gate is sub-pixel and therefore unhittable at zoom 12. The metric threshold in section 17a stands unchanged for draw-to-splice.
* The projection itself stays metric: the tap is snapped with `nearestPointOnLine`, and only the accept/reject test is measured in pixels via `map.project()`.
* **That last note was wrong, and the code proves it.** `jumpTo` begins with `this._stop()`
  (`mapbox-gl-dev.js:96135`), so a tracking frame cancels any running animation. A zoom
  `easeTo` was being killed about 16 ms in while playing. The tracking loop therefore owns the
  zoom: a request sets a target and each frame eases towards it, the same shape as the bearing
  smoothing. A pinch writes straight into that target, or the next frame would drag the zoom back.
* The ease also runs unconditionally. Tracking frames are driven by telemetry, which is static
  while paused, so a centred-but-stopped route gets no frames at all and the ease is the only
  thing that applies the zoom. While tracking it passes the vehicle coordinate and the anchor
  padding, because a zoom-only ease zooms about the map centre and the marker is not there.
* The vehicle anchor is applied as `padding` with `retainPadding: false`. Mapbox clones the
  transform and calls `setLocationAtPoint` (`mapbox-gl-dev.js:96156`), so the anchor shifts one
  camera move without sticking to the map and skewing fit-to-route afterwards. `jumpTo` cannot
  take an `offset`: that lives on `AnimationOptions`, which only `easeTo` and `flyTo` accept.
* The tap threshold is screen-space (44px) while the draw threshold in section 17a stays metric.
  A finger is a fixed physical size; a 25 m gate is sub-pixel at zoom 12.
* The lock is an invariant, not a flag: every write that drops `routePoints` below two clears it.
  Guarding only the setter left a route that could be emptied from the drawer while locked, which
  stranded the UI in a Drive layout whose lock button was disabled.

## 26. Verify

```bash
npm run build          # tsc -b strict + vite build
npm run lint           # oxlint
npm test               # headless suites
```

Existing suites that must stay green, in particular the marker-stability guard in `tests/geo.test.ts` (0 direction flips, max 0.051 deg/frame): phase 4 touches the camera path that guard protects.

Human-verify only, to be reported as unverified rather than claimed: AC-504 and AC-505 feel, AC-506 placement, AC-511 pinch, AC-512 drag, the 0.75 anchor in motion, and all Android behaviour.

## 27. Known Risks

* **Pinch and heading-up rotation compete.** Touch pinch arrives through `touchZoomRotate`, the same handler that rotates. Suppressing only its rotation while tracking is the plan, and it cannot be verified headlessly - AC-511 is on-device only.
* **Lock doubling as the layout switch** means a single flag drives both behavior and presentation. If the two ever need to separate, D-1 is the decision to revisit.
* **The vehicle anchor and the cluster height are tuned against each other.** The 200px clearance is a guess at the cluster's real height plus a margin; growing the cluster again could put the marker behind it on a short screen.
* **A tap that lands where the route crosses itself** projects ambiguously, the same unresolved case as the V2 splice note. The cursor may jump to the wrong branch.

---

# Part IV - Version 4: OBD-II Live Vehicle Tracking

**Status:** Approved specification (planning session). Parts I to III above describe the shipped V1, V2 and V3 application.

**Goal:** While driving, the vehicle cursor advances along the route from the car's own measured speed instead of the slider, with odometer anchoring to keep accumulated drift bounded.

## 28. Locked Decisions

| # | Decision |
|---|---|
| D-15 **[revised]** | Target runtime is **Safari plus the beacio extension, in a browser tab**. Measured on iOS 18.7 / Safari 27: the extension injects `navigator.bluetooth` in a tab and does **not** inject in a Home Screen web app. That is architectural - the standalone container is process-isolated and extensions cannot reach it - and there is no configuration that changes it. Being Safari, the origin is shared with the existing PWA, so the token and route history carry over. |
| D-26 | **Bluefy is deferred to phase 4.** It has no iOS Local Network entitlement, so it cannot reach a LAN host at all and is untestable locally. It remains the only route that could give standalone *and* OBD, because its polyfill lives in its own app process rather than in an extension, so it is re-evaluated once the app is deployed. |
| D-27 | Development runs entirely against the **local preview origin in a Safari tab**. Deploying and the Bluefy evaluation happen after phases 1 to 3, not before. |
| D-16 | Adapter is the **Konnwei KW906** - ELM327 v1.5, PIC18F25K80, BLE GATT on iOS. Service and characteristic UUIDs are **discovered at runtime**, not hardcoded; `FFE0`/`FFE1` is the expected but unguaranteed pair. |
| D-17 | Position is **dead-reckoned from OBD speed**. There is no GPS. Accepted consequence: a wrong turn is undetectable and the cursor keeps advancing along the planned route. |
| D-18 | **Odometer PID `01A6` anchors the dead reckoning** when the vehicle supports it. Support is probed once at connect via the `01A0` bitmap and never assumed. |
| D-19 | Calibration `k` is derived from **cumulative** odometer distance over cumulative raw integration, not per-window. Quantization error then shrinks as the drive lengthens instead of staying at 100 m. |
| D-20 | Corrections **bleed in over ~2 s**; the cursor never teleports. Same principle as `lerpBearing` and the V3 zoom easing. |
| D-21 | When connected, the adapter writes `config.speedKmh` and the slider renders **read-only**. No third mode: V3's lock and Drive layout are reused unchanged. **Clarified in build:** a connected adapter always updates the displayed speed, but the cursor only follows the car once Play has been pressed. Before that the marker stays where planning left it, which keeps connecting the adapter safe while a route is still being built. |
| D-22 | v1 polls **speed and odometer only**. No RPM, coolant, fuel or load - the response budget goes to position accuracy. |
| D-23 | Trip data is **not recorded**. `k` is the sole exception: it describes the car, not the trip, so it persists in settings. |
| D-24 | `navigator.bluetooth` absent -> the entire OBD surface is hidden. The existing PWA must not change in any observable way. |
| D-25 | Integration is **trapezoidal over measured timestamps**, never assumed intervals. A gap beyond `DT_MAX` is discarded, not integrated. |
| D-28 | **The speed slider is replaced by a + / - pair around a circular speedometer.** A slider asks for a precise drag, which is the one gesture a driver cannot give; discrete presses can be made without looking. The increment is configurable in Settings (default 10 km/h) so one pair serves both careful planning and coarse adjustment at speed. The speedometer doubles as the km/h - mph toggle, which removes a control from the row. This supersedes the slider half of D-6; the requirement that the speed *row* stays visible while locked is unchanged. |
| D-29 **[revised]** | The speed pair is sized **like the step buttons** - 72px, 88px in Drive - not like the zoom pair. It is pressed while driving rather than set once before setting off, so it earns a full thumb target. Reset-to-start takes the 44px secondary size instead, being a planning action that disappears when locked. |
| D-31 | **Speed and playback merged into one dial**: a ring that fills with speed, play/pause in the centre, the reading beneath it. The whole circle is a single tap target for play/pause. The two interactions are not equally important - play is pressed constantly and must never be mis-hit, while the km/h - mph switch is set once - so the unit toggle moved to Settings beside the speed increment. The ring earns its place separately from the number: an arc length is readable without focusing on it, which a two-digit number is not. |
| D-32 | The left column reads **bottom-up by frequency**: plus and minus above, the dial lowest and largest, nearest the thumb. |
| D-34 | **Speed increments are per direction**, stored in km/h: +10 up, -5 down by default. Winding up to a cruising speed wants bigger jumps than easing back down to a safe one - the same asymmetry the step distances already have. |
| D-35 | **One unit system, not a toggle per quantity.** `unitSystem` is metric or imperial and drives the speed readout and every distance shown. Metric is the default. Increments are typed in whatever units are on screen and stored in km/h, so switching systems does not silently rewrite what the buttons do. Known limit: the step *distance* inputs in Settings stay in metres, because converting them round-trips through rounding; their button labels do follow the system. |
| D-36 | **The lock moves beside the menu in the top-left; reset-to-start takes its place in the top-right.** This supersedes D-10's placement, not its sizing - the lock is still a 48px row control rather than a Drive target. |
| D-56 **[supersedes D-37 and D-39]** | **The location control is a marker toggle, not a route action.** It shows where the device is - a blue disc with an arrow - and places no stops. It is offered whether or not a route exists, collapsing to an icon in a circle once the row is busy. The crossed icon states what the next press will do rather than what the current state is. |
| D-57 | **The position is watched continuously while the marker is on** (`watchPosition`), not sampled once. A stale dot on a moving vehicle is worse than no dot, and a direction arrow on a pinned position means nothing. The watch is torn down on toggle-off and on any error. |
| D-58 | **The arrow follows GPS course while moving and the compass at rest.** GPS reports the direction of travel and is unaffected by the steel box the phone sits in; the compass is the only source that knows which way you face at a standstill. Below `MOVING_SPEED_MS` (0.5 m/s) a satellite course is derived from jitter, which is why a parked arrow spins without the threshold. A device that reports a heading but no speed is trusted. With neither source, **no arrow is drawn** - a fixed arrow on an unknown heading is a confident lie. |
| D-59 | **The camera flies to the marker once, on the first fix.** After that the view is the user's: following the marker would fight both manual panning and the vehicle tracking, which already owns the camera during playback. |
| D-37 **[renamed; superseded by D-56]** | **"My location" seeds an empty route from the device's location.** Named for what it uses rather than what it does: "Start" collides with the Play control, and "begin the simulation" is the one misreading this button cannot afford. Offered only while no stops exist and only where `navigator.geolocation` is present, and it disappears the moment a stop is added. It seeds a route; it does not navigate one, and GPS still does not drive the cursor. |
| D-38 **[revised]** | **The location control gets its own right-aligned row under the stop list**, with the status hint on the row below it. It was first pinned out of flow across the hint, which collided in practice: the centred hint is about 228px wide on a 393px screen and the button about 116px, overlapping by roughly 45px. Two rows cannot overlap, and the cost is that the zoom stack shifts down once while the route is empty. |
| D-39 | **Seeding from a location flies the camera to it.** The one exception to the rule that placing a stop never moves the camera: a pin the driver cannot see is not confirmation the fix landed where they are. It zooms no further out than it already is. |
| D-49 | **The three square controls gather in the left corner; the distance and ETA panel takes the right.** The panel's width follows the route and the buttons' does not, so giving it the whole of the remaining width is what stops the two competing. This reverses D-44's separate row, which is no longer needed now the stop-list button has gone (D-48). |
| D-52 | **The arrival estimate is removed.** The panel shows distance and the stop count only. ETA was the widest thing in a block that has to share a row with three buttons, and it is derived from a speed the driver is choosing rather than measuring - so it told them something they had just decided. `formatEta` stays in `format.ts`, still covered by its tests, because the estimate may return once OBD speed is driving it for real. This supersedes the ETA half of D-6. |
| D-54 | **Mirroring flips the whole interface, not just the thumb columns.** The top row reverses, so the three squares and the distance panel swap corners; the zoom pair, the hint and the location control ride the band that reverses with them; the menu opens away from its own edge; and both drawers open from the other side. Supersedes the exemption in D-9 - a left-handed layout that mirrors half the screen is worse than one that mirrors none of it. |
| D-55 | **The zoom pair, the hint and the location control share one band** directly under the header, aligned to its top edge, so the hint and the button sit level with the zoom-in button instead of below the whole stack. The zoom pair leads the row, which keeps it immediately beneath the menu and means a hint that comes and goes can never shunt it up and down. |
| D-53 **[revised]** | **The zoom pair renders directly under the menu**, as a sibling of the header ahead of the status row rather than after it. It was previously last in the overlay column, so the transient hint shunted it up and down the screen as stops were added and removed - a control the driver reaches for without looking must not move. |
| D-51 | **The status row stands down while the stop list is open.** The drawer covers roughly 306px of a 393px width at that height, so the centred hint rendered on top of the list it was explaining how to fill. Nothing is lost by hiding it: the drawer disables its own controls while a route calculates, and failures surface as toasts, which sit above everything. |
| D-50 | **The plan drawer clears the top row by measurement.** `TopBar` publishes `--top-row-height`; the drawer's `TOP_OFFSET` reads it. The literal 4.5rem stopped being true when the distance panel moved into that row, so the panel overlapped the drawer it opens - the same class of bug as the cluster height, at the other end of the screen. The location control also stands down while the drawer is open, rather than sitting under it. |
| D-47 | **Nothing on the map paints above the controls.** Pins are pinned to z-index 0 and the vehicle to 1; every overlay takes a named layer from one scale in `ui.ts` (cluster 10, plan drawer 20, top stack 30, history 40, modal 50, toasts 60). Mapbox assigns markers a z-index of its own for depth sorting, which let a pin dropped near a corner paint over the menu. Stacking that was implied by DOM order is now stated. |
| D-48 | **The telemetry pill is the way into the stop list**, and the separate list button is gone. The numbers and the list describe the same thing, so a tap on "1.5/2.0 km, 3 min" asking to see which stops those are is the obvious gesture - and it returns a slot to a row that had run out of them (D-44). The count moved onto the pill. |
| D-44 | **Telemetry gets a row of its own**, below the header rather than between the buttons in it. Its width depends on the route - `15.2/120.5 km` against `0.0/0.0 km` - and four 48px buttons plus gaps leave about 145px for a pill that wants nearer 190px on a built route. A width that varies with the data cannot share a row with a fixed set of controls. |
| D-45 | **The thumb pairs and the zoom pair are circles**, matching the dial. `GLASS_BUTTON` no longer carries its own rounding: two `border-radius` utilities in one class list resolve by stylesheet order rather than by which was written last, so every call site states its shape. The top row keeps rounded rectangles, since those carry text and a count badge. |
| D-46 | **Text on thin glass is a tier brighter.** The telemetry labels moved from `slate-500` to `slate-300` and the map hint from `slate-400` to `slate-100`. Those greys were chosen against 85% glass; at 60% there is not enough behind them to read against over bright tiles. |
| D-43 | **Glass comes in two thicknesses.** `GLASS_SURFACE` (60%) for small floating controls, which are read from shape and position; `GLASS_PANEL` (85%) for Settings, the history drawer and the plan drawer, which carry body text, form fields and lists. A control can be recognised from its outline, a paragraph cannot. Both panels sit over a darkening scrim as well, which is what makes 85% sufficient rather than opaque. |
| D-42 | **The glass surface approximates a physical pane**: thinner tint with a heavier blur and a saturation lift, a specular rim (bright inset line on the top edge, dark on the bottom) and a faint diagonal sheen. The rim does most of the work. Refraction is deliberately absent - warping the map behind each pane needs an SVG displacement filter through `backdrop-filter`, which Safari supports only partly and which would composite over a live WebGL canvas every frame, landing its cost during playback. The tint holds at 60% because legibility over sunlit tiles is real work the opacity was doing. |
| D-41 | **The speed +/- pair is hidden while the adapter is connected**, not disabled. The car owns the speed then, and a greyed-out pair is a control the driver has to look at only to rule out. The store guard on `adjustSpeed` stays regardless: absent UI is not a closed door. The dial remains, since it is still play/pause and the reading. |
| D-40 | **Thumb targets are square.** The left column is as wide as the dial, so a stretched child rendered a 96x72 rectangle; the columns centre their children and the buttons carry `aspect-square`. |
| D-33 **[supersedes part of D-13]** | The marker's bottom clearance is **measured, not assumed**. `ControlPanel` publishes `--control-cluster-height`; `MapView` passes it to `trackingPadding`. The old centre fallback is removed: once the cluster passes half the viewport the middle of the screen sits *below* the top of the controls, so falling back to it hid the marker in exactly the case the clearance exists to prevent. Clearance now wins outright, floored at `MIN_VEHICLE_SCREEN_ANCHOR` (0.3) so the marker cannot climb off the top. |
| D-30 | **Every control in the thumb columns is its own floating button.** Nothing is grouped into a shared pane: the left column stacks play, the speedometer, minus and plus; the right column stacks reset (unlocked only), step forward and step back. A shared surface read as one strip and made the individual targets harder to find by feel. |

**Accepted consequence of D-17:** the app can be confidently wrong. Having left the route, the cursor keeps advancing along the planned geometry with no signal that it has diverged. This was chosen deliberately over adding GPS, and section 39 records it as the largest functional gap.

## 29. Constraints

* **Zero new dependencies.** The ELM327 client is hand-rolled, roughly 200-300 lines.
* TypeScript strict; `tsc -b` and `oxlint` must stay clean.
* No browser, no BLE and no vehicle exist in the build environment. Every on-device criterion is human-verify and must be reported as unverified rather than claimed.
* Section 5 layout rules and V3's D-6 remain binding: the speed row stays visible while locked.
* Foreground-only, as playback already is. Backgrounding the browser suspends both the rAF loop and BLE delivery.

## 30. Glossary

* **Anchor** - an absolute distance fix from the odometer that corrects accumulated integration error.
* **Residual** - the signed difference between anchored and integrated distance, pending bleed-in.
* **k** - calibration scale applied to integrated speed, correcting tire and quantization bias.
* **Degraded** - tracking is connected but a sample gap exceeded `DT_MAX`, so distance is known to be under-counted.

## 31. Architecture

The single design requirement is that **only one file touches `navigator.bluetooth`**. Everything above that line is pure and headlessly testable against the existing `vite ssr build -> node` harness.

```
src/lib/obd/
  transport.ts   ObdTransport interface + WebBluetoothTransport  <- only impure file
  elm327.ts      line assembler (frames on '>'), command queue, AT init
  pids.ts        encode/decode 010D, 01A6, support bitmaps
  reckoning.ts   trapezoidal integrator, k estimator, residual bleed  <- pure
```

**[revised]** `useObd.ts` was not built. The session - client, poll timer, reckoning state -
lives in the store's closure beside `stepAnimation`, for the same reason that does: it
changes several times a second and nothing renders from it directly, so holding it in
React state would re-render the tree for arithmetic. The store already owns non-React
timers for toasts, so this adds no new pattern. `setObdTransportFactory()` is the seam
the suites inject through, and `pollObdOnce()` is exposed so tests drive a cycle instead
of waiting on an interval.

```ts
interface ObdTransport {
  connect(): Promise<void>;
  write(command: string): Promise<void>;
  onData(handler: (chunk: string) => void): () => void;
  onDisconnect(handler: () => void): () => void;
  disconnect(): Promise<void>;
  readonly state: 'disconnected' | 'connecting' | 'connected';
}
```

**[revised]** This sketch originally read `onLine`. The assembler belongs to `elm327.ts`
by this section's own file split, and a BLE notification arrives in roughly 20-byte
fragments that cut across line boundaries, so nothing at the transport level can
honestly hand out lines. It deals in raw chunks and the method is `onData`.
`onDisconnect` was added because an in-flight command has to reject when the link drops,
or a disconnect mid-drive leaves a promise pending for ever.

Tests inject a scripted fake transport replaying canned ELM327 byte streams, including notifications split mid-line, since BLE delivers about 20 bytes per notification and responses frame on the `>` prompt.

**Init sequence:** `ATZ`, `ATE0` (echo off - without it every response carries the echoed command), `ATL0`, `ATH0` (headers off, fewer bytes), `ATSP0`, `ATAT1`, then the probes `0100` and `01A0`.

**Throughput:** commands are suffixed with the expected response count (`010D1`), which makes the ELM return immediately rather than waiting out its timeout. On a clone this is the difference between roughly 2 Hz and 5 Hz.

**Decode:** `41 0D A` -> `A` km/h. `41 A6 A B C D` -> `((A<<24)|(B<<16)|(C<<8)|D) * 100` metres.

## 32. Reckoning Algorithm

Per speed sample `(v, t)`:

```
dt = (t - tPrev) / 1000
if dt > DT_MAX (3 s):
    discard interval, set degraded, tPrev = t, return
ds    = k * ((vPrev + V_BIAS) + (v + V_BIAS)) / 2 * (1000/3600) * dt
dsRaw = ds / k
rawIntegratedMeters += dsRaw
applyDistance(distance + ds + bleed(residual, dt))
```

`V_BIAS = 0.5` km/h, correcting the truncation in a 1 km/h/bit PID.

Per odometer sample `odoRaw`:

```
odoDelta = (odoRaw - odoPrev) * 100          // metres
if odoDelta <= 0: return                      // no tick yet, or rollover
odoTotalMeters += odoDelta
residual += odoTotalMeters - (rawIntegratedMeters * k)
if rawIntegratedMeters > 2000:
    k = clamp(odoTotalMeters / rawIntegratedMeters, 0.8, 1.2)
odoPrev = odoRaw
```

The 2 km gate holds odometer quantization at or under 5% of the measurement before `k` is trusted; the clamp rejects implausible values outright.

`bleed()` is exponential with a 1 s time constant, **rate-capped at `MAX_BLEED_FRACTION` (0.5) of the distance actually covered in that sample**. Small residuals ease away quickly; large ones are held to half the natural step, so a frame never moves the marker more than 1.5x its real motion. Because the cap scales with distance covered, a stationary car receives no correction at all - correct behaviour, since a cursor sliding forward while parked would be worse than a stale one.

**Why the odometer is worth the poll slot.** Integrated speed error is unbounded and grows with distance; odometer error is bounded at about 100 m no matter how far the car travels, because each read is re-anchored to truth. The odometer alone is too coarse to move a cursor smoothly at a 250 m step distance, so neither source is sufficient on its own. The ratio of the two over the same interval is exactly the calibration factor, so `k` is learned without the driver measuring anything, and remains useful if `01A6` later stops answering.

## 33. V4 Scope

### 33.1 In Scope

* `ObdTransport` plus the Web Bluetooth implementation, with runtime UUID discovery.
* ELM327 client: line assembler, command queue, AT init, PID support probe.
* `010D` and `01A6` decode; round-robin scheduler at roughly 4 Hz speed and 1 Hz odometer.
* Pure reckoning module: trapezoidal integration, `k` estimation, residual bleed, `DT_MAX` guard.
* Store: an `obd` slice, the adapter writing `config.speedKmh`, and a read-only slider while connected.
* Connect, disconnect and status UI, feature-gated on `navigator.bluetooth`.
* `k` persisted in settings.

### 33.2 Out of Scope (deferred)

* GPS of any kind, and therefore any off-route detection.
* Trip recording, replay, planned-versus-actual overlay and export.
* RPM, coolant, fuel level, engine load and DTC reading.
* Silent auto-reconnect and background tracking. **Auto-reconnect is provisional**: `getDevices()` exists on the measured runtime, so it may move into scope once its behaviour is confirmed (section 37).
* Android, Safari-native and desktop support.

## 34. Acceptance Criteria

* **AC-616 [revised] The location control shows the device, and nothing else.** `navigator.geolocation` present. Expected: pressing it starts a watch and renders a blue marker at the reported position, with an arrow only when a heading is known; pressing again stops the watch and removes the marker. The control is offered with or without a route, and collapses to an icon-only circle once stops exist. Must not: add a stop, move the cursor, or leave a watch running after it is switched off. Verify: automated store and render tests; the marker itself is human-verify. Required.
* **AC-618 [revised] The first fix focuses the map.** Marker switched on, a fix returned. Expected: one focus request carrying that coordinate, and the camera flies there. Must not: raise a further request on later fixes, or zoom further out than the current view. Verify: automated store test; the flight itself is human-verify. Required.
* **AC-617 Units switch everything at once.** Settings set to imperial. Expected: the dial reads mph, the speed buttons label in mph, the step buttons label in feet or miles, and telemetry reads miles. Switching back restores metric, which is the default. Verify: automated. Required.

### Transport and protocol

* **AC-601 Chunked responses assemble.** Fake transport emits `41 0D 3C\r\r>` split across three notifications at arbitrary byte boundaries. Expected: exactly one decoded sample of 60 km/h. Must not: emit a partial or duplicate sample. Verify: automated. Required.
* **AC-602 Odometer support is probed, never assumed.** Fake transport answers `01A0` with a bitmap where the A6 bit is clear. Expected: `01A6` is never sent, and the session reports speed-only mode. Must not: send A6 anyway and treat `NO DATA` as zero. Verify: automated assertion on the command log. Required.
* **AC-603 Init sequence and echo suppression.** On connect. Expected: `ATZ`, `ATE0`, `ATL0`, `ATH0`, `ATSP0`, `ATAT1` are sent in that order before any `01xx` request. Verify: automated. Required.

### Reckoning

* **AC-604 Constant speed integrates exactly.** 100 km/h held for 60 s, `k = 1`, `V_BIAS = 0`, samples every 250 ms. Expected: 1666.7 m within 0.1 m. Verify: automated. Required.
* **AC-605 Trapezoid beats rectangle on a ramp.** Linear 0 to 100 km/h over 10 s at 250 ms. Expected: the trapezoidal result is within 0.5 m of the analytic 138.9 m, and the zero-order-hold result is recorded and is strictly worse. Verify: automated. Required.
* **AC-606 `k` converges on a mis-scaled speedometer.** Speed samples 5% low, odometer consistent with truth, 10 km driven. Expected: `k` settles in `[1.045, 1.055]` and cumulative distance error falls below 0.5%. Must not: move `k` before 2 km of integration. Verify: automated. Required.
* **AC-607 `k` rejects nonsense.** Odometer implying a 40% scale error. Expected: `k` clamps at 1.2 and the session flags calibration as rejected. Verify: automated. Required.
* **AC-608 A dropout invents no distance.** Samples at 60 km/h, then a 10 s gap, then resumption. Expected: the gap contributes 0 m, `degraded` is set, and no more than 0.2 m is attributed to the gap interval. Must not: hold the last speed across the gap. Verify: automated. Required.
* **AC-609 [revised] Corrections bleed, never jump.** A residual of +80 m injected while moving at 50 km/h. Expected: no single frame moves the cursor more than 1.5 times its uncorrected step, and the residual falls below 5 m within **12 s**, then is fully absorbed rather than abandoned. Verify: automated. Required.
  *Constraint that forced the change:* the original criterion asked for both the 1.5x per-frame ceiling and clearance inside 4 s. Those are arithmetically incompatible. At 50 km/h the car covers 55.6 m in four seconds, so clearing 80 m as well means moving 135.6 m - about 2.4 times the natural rate, which is precisely the teleport D-20 forbids. Smoothness is the property worth keeping, so the ceiling stands and the window relaxes. Measured: the residual clears at 10.75 s, with the worst frame landing exactly on the ceiling.
* **AC-609b A stationary car is never corrected forward.** Residual of +60 m outstanding, reported speed 0. Expected: the cursor does not move at all, and the residual is preserved for when the car moves again. Must not: creep the marker down the road while parked, which is both wrong and highly visible. Verify: automated. Required.
* **AC-610 Odometer rollback is ignored.** A sample lower than its predecessor. Expected: no residual change, no `k` change and no negative distance. Verify: automated. Required.

### Integration

* **AC-611 [revised] A connected adapter writes the speed.** OBD connected, sample of 73 km/h. Expected: `config.speedKmh` is 73, the slider input is `disabled`, and the displayed speed reads 73. Must not: let a thumb drag change it. Verify: automated store and rendered-tree test. Required.
* **AC-612 Disconnect restores manual control.** Connected, then disconnected. Expected: the slider becomes writable and retains its last value, the cursor stops advancing, and one toast fires. Verify: automated. Required.
* **AC-613 No Bluetooth, no regression.** `navigator.bluetooth` undefined. Expected: no OBD control renders anywhere, and the rendered tree is byte-identical to the current build. Verify: automated rendered-tree comparison. Required.
* **AC-614 Route end clamps.** Cursor within 50 m of the end with speed still arriving. Expected: distance clamps at `totalDistanceMeters`, playback stops, and one toast fires. Must not: accumulate distance past the end and desync `k`. Verify: automated. Required.
* **AC-615 Real drive in Bluefy.** KW906 fitted, route loaded, about 10 km driven. Expected: the cursor tracks the car visibly, and end-of-drive error against the dashboard odometer is under 2%. Verify: human, on device. Unverifiable in this environment and to be reported as unverified. Required.

## 35. Failure Behavior

| Situation | Expected |
|-----------|----------|
| `navigator.bluetooth` absent (Safari) | OBD surface hidden entirely; no toast, no trace |
| User cancels the device picker | Return to disconnected silently; no toast |
| Adapter found but no writable notify characteristic | Error toast naming the failure; stay disconnected |
| `ATZ` unanswered within 5 s | Abort, error toast, disconnect |
| `01A0` shows A6 unsupported | Speed-only mode; Settings exposes a manual `k`; one info toast |
| `01A6` answers `NO DATA` mid-drive | Stop polling it, keep the last `k`, degrade silently |
| Sample gap beyond `DT_MAX` (3 s) | Discard the interval and set `degraded`; never integrate the gap |
| BLE disconnect mid-drive | Stop advancing, slider writable, error toast, offer reconnect |
| Odometer non-monotonic or rolled over | Ignore the sample entirely |
| Ignition off and the adapter sleeps | Treated exactly as a BLE disconnect |
| No route loaded | Connect is still offered; speed displays; the cursor does not move |
| Connected while the route is locked | Unaffected; V3 lock semantics are unchanged |
| Driver leaves the route | Undetectable by design (D-17). The cursor keeps advancing; V3 tap-to-move is the manual re-anchor |

## 36. Phases

1. **Transport and protocol** - `ObdTransport`, the fake transport, the assembler, the queue, init and decode. AC-601..603. **COMPLETE**: `src/lib/obd/{transport,elm327,pids}.ts` and `tests/obd-protocol.test.ts`, 36/36 passing.
2. **Reckoning** - the pure integrator, `k`, the residual and the guards. AC-604..610. **COMPLETE**: `src/lib/obd/reckoning.ts` and `tests/reckoning.test.ts`, 30/30 passing, `tsc -b` and `oxlint` clean.
3. **Store and UI** - the `obd` slice, slider takeover, connect control and the feature gate. AC-611..614. **COMPLETE**: 34/34 passing in `tests/obd-store.test.ts`.
4. **Field verification** - Bluefy, KW906 and a real drive. AC-615 and every assumption in section 37.

Phases 1 and 2 are independent and may run in parallel. Phase 4 cannot start until a Bluefy build is reachable.

## 37. Measured Runtime Environment

Measured on device with `public/ble-probe.html`, iPhone on iOS 18.7, Safari 27, in a
tab on the local preview origin with the beacio extension enabled for all websites.
These are readings, not assumptions.

| Reading | Value | Consequence |
|---------|-------|-------------|
| `navigator.bluetooth` | present | V4 is viable; D-15 settled |
| `requestDevice` | function | Connect path available |
| `getDevices` | function | Silent reconnect may be possible - see below |
| `getAvailability()` | true | Adapter radio reachable |
| `isSecureContext` | true | Web Bluetooth and service worker both satisfied |
| `navigator.wakeLock` | **present** | The screen-sleep risk is closed |
| Service worker | active, 1 registration | Offline shell works in a tab |
| `display-mode` | `browser` | No standalone; extensions cannot reach it |
| `navigator.standalone` | false | Same |
| Safe-area insets | 0 on all four sides | `env()` gives no protection in a tab |
| `ControlPanel` pad-bottom | 12px (the `0.75rem` floor) | Cluster sits tight to the viewport edge |
| Viewport | 393 x 695, screen 393 x 852 | **157px, about 18%, lost to browser chrome** |
| D-13 clearance | preferred 174px, below the 200px floor | `camera.ts:44-47` clamps the anchor to 495px and holds exactly 200px clearance, as specified |

The app sizes itself with `height: 100%` on `html, body, #root` rather than `100vh`, so
the root box is the visible viewport and no content is hidden behind Safari's toolbar.
The cost of a tab is a smaller map, not a broken layout.

### Still to confirm

* **Does `getDevices()` return previously permitted devices?** Its presence contradicts the
  original assumption that a manual tap would be needed every session. If it works, silent
  auto-reconnect moves from section 33.2 into scope, which materially improves the driving
  experience - the app reconnects when the car starts instead of demanding a picker at the wheel.
* **The KW906's real service and characteristic UUIDs**, from the probe's scan. D-16 discovers
  them at runtime, but phase 1 wants the actual values to test against.
* **Whether this particular car answers `01A6` at all.** Everything about bounding drift depends on it.
* **`MIN_VEHICLE_BOTTOM_CLEARANCE = 200`** has never been validated against the Drive cluster's
  real rendered height. Section 39 has flagged it as a guess since V3; it is now measurable.
* **Bluefy plus Add to Home Screen**, once deployed (D-26).

## 38. Verify

```bash
npm run build          # tsc -b strict + vite build
npm run lint           # oxlint
npm test               # headless suites
```

New suites: `tests/obd-protocol.test.ts` (AC-601..603), `tests/reckoning.test.ts` (AC-604..610) and `tests/obd-store.test.ts` (AC-611..614). Existing suites must stay green, in particular the marker-stability guard in `tests/geo.test.ts`: phase 3 writes `applyDistance` at roughly 4 Hz, which is a new load on the path that guard protects.

Human-verify only, to be reported as unverified rather than claimed: AC-615, every item in section 37, and all adapter behaviour on a real vehicle.

## 39. Known Risks

* **There is no off-route detection at all.** This is the deliberate cost of D-17. After a missed turn the app shows a confident but wrong position with no signal that it is wrong. It is the largest functional gap, and adding GPS later is the only real fix.
* **Odometer support is a coin flip.** If `01A6` is unsupported, drift is unbounded and the design falls back to a manual calibration constant plus tapping the route to re-anchor.
* **Clone throughput is not guaranteed.** Four to ten responses per second is typical, but a slow adapter pushes speed sampling toward 2 Hz, where 250 ms of cursor granularity at 100 km/h is about 14 m per sample.
* ~~Wake lock unverified~~ - **closed.** `navigator.wakeLock` is present on iOS 18.7 / Safari 27.
* **A tab costs 18% of the map.** 695px of usable height against a 852px screen. The look-ahead
  that V3 built the 0.75 anchor and the zoom work for is measurably reduced, and only standalone
  would give it back - which the extension cannot provide (D-15).
* **`MIN_VEHICLE_BOTTOM_CLEARANCE = 200` is still a guess.** In a tab the anchor clamps against it
  on every frame rather than occasionally, so if the Drive cluster is taller than 200px the marker
  now sits behind it permanently rather than rarely.
* **The slider changes meaning by context** (D-21): read-only when connected, writable when not. Cheap in code, and a real source of confusion if the connection state is not obvious at a glance.

# Part V - Traffic Overlays

## 40. Goal

Paint live road conditions over the map: congestion from Mapbox, and incidents
(accidents, closures, road works, weather hazards) from TomTom.

Mode: implement.

## 41. Decisions

* **D-60. Two independent overlays, not one.** Congestion and incidents have different
  costs: the congestion tileset ships with the map tiles already being loaded, while
  incidents are a metered third-party call. A driver who wants one is not made to pay
  for the other, so they are separate toggles and separate persisted settings.
* **D-61. Congestion comes from `mapbox://mapbox.mapbox-traffic-v1`.** No second key, no
  extra request, and it caches like any other tile.
* **D-62. Incidents come from TomTom Traffic Incidents v5,** chosen in
  `traffic-data-research.md` over the Waze reseller on licensing grounds. Free tier is
  2500 requests/day.
* **D-63. The incident fetch is scoped to the route, not the viewport** (supersedes the
  first implementation, which fetched on `moveend`). Incidents are fetched when the
  driver commits to a route by locking it, not while planning. This is what keeps a day
  of use inside the free tier: a drive costs one request rather than one per pan.
* **D-64. Play fetches too, because Play locks.** `play()` sets `isRouteLocked` directly
  rather than calling `setRouteLocked`, so both paths call one shared
  `startIncidentsForDrive()` helper. Inlining it twice is how the two would drift.
* **D-65. The cache is keyed on route geometry, not on route id.** Dragging a stop
  rebuilds geometry under the same id, and stale incidents pinned to roads the driver is
  no longer taking are worse than no incidents at all.
* **D-66. A half-hour refresh while locked, and a manual refresh button.** Conditions
  change over a long drive. The manual path is the only one that ignores the cache.
* **D-67. No TomTom key is a no-op, never an error.** `traffic.status` is `unavailable`,
  no incident control renders, no request is attempted, and nothing else in the app
  behaves differently. Mirrors the D-24 Web Bluetooth gate.
* **D-68. Congestion paints below the route, incident symbols above it.** A severe
  congestion band runs along the same street as the planned route and would bury it; an
  incident marker hidden under the route line is worse than not drawing it.

## 42. Acceptance Criteria

* AC-701: overlay on + route present + lock pressed -> exactly one TomTom request.
  Verify `tests/traffic.test.ts`.
* AC-702: [removed] the zoom floor belonged to the viewport policy (D-63).
* AC-703: [removed] bbox containment belonged to the viewport policy (D-63).
* AC-705: bbox is sent as `minLon,minLat,maxLon,maxLat` and the key is URL-escaped.
* AC-706: `iconCategory` maps to a label and to one of four colour groups.
* AC-707: every incident gets exactly one symbol, including line-geometry ones.
* AC-708: a key present -> status `idle` and the incident controls render.
* AC-709: toggling congestion spends no request.
* AC-711: toggling incidents off clears the layer, the cache and the refresh timer.
* AC-712: a failed fetch sets `status: 'error'`, raises a toast, and leaves no cache, so
  the next lock retries.
* AC-713: the fetched box covers the whole route, padded, with a floor so a due-north
  route is not queried as a zero-width line.
* AC-714: rebuilding the route invalidates the cache; the next lock re-fetches.
* AC-715: no TomTom key -> no request on lock or on forced refresh, no throw, route
  still locks.
* AC-716: re-locking an unchanged route within the window spends nothing.
* AC-717: the refresh window is 30 minutes exactly.
* AC-718: the manual refresh fetches despite a warm cache, but not with the layer off.
* AC-719: panning and zooming spend nothing.
* AC-720: Play locks the route and takes the same fetch path as the lock button.
* AC-721: switching the layer on while already locked fetches immediately.

## 43. Failure Behavior

| Situation | Expected |
|---|---|
| No `VITE_TOMTOM_API_KEY` | Incident controls not rendered; no request; app unaffected |
| TomTom 403 (bad key) | Toast, `status: 'error'`, cache left empty so the next lock retries |
| TomTom 429 (rate limit) | Same, with a rate-limit message |
| Network failure | Same, with a network message |
| Malformed incident record | That record dropped; the rest of the batch still renders |
| Incident with no geometry | Dropped |
| Route locked with no geometry | No request (no box to ask about) |

## 44. Known Risks

* **Both keys are inlined into the bundle.** Unavoidable for a browser app with no
  server. Before any public deploy, restrict the Mapbox token by URL and the TomTom key
  by referrer in their consoles.
* **Route-scoped fetching means incidents off the planned route are not shown.** That is
  the deliberate trade for staying inside the free tier. A driver who diverts far from
  the route sees stale data until the next refresh.
* **The congestion tileset is Mapbox's, and its coverage varies by country.** It is not
  verified for the user's region.
* **Not yet verified against a live TomTom response.** Parsing is tested against a
  recorded-shape fixture, not the real API.

## 45. Speed Cameras (Part V, second layer)

### Decisions

* **D-69. Cameras come from OpenStreetMap over Overpass,** not from a traffic vendor.
  Camera databases are licensed products, and OSM is the only free source. It is also
  the only one of the three hazard layers with data where this app is actually used:
  measured 2026-09-24, TomTom returns zero incidents for all of Ukraine and the Mapbox
  traffic tileset has no segments in Kyiv, while OSM has 28 cameras in the centre.
* **D-70. Cameras are static, so the cache has no TTL.** Only a changed route
  invalidates it. Re-asking Overpass every half hour for a set of fixed posts would
  spend its goodwill for nothing.
* **D-71. Overpass failures are silent.** The public instances rate-limit hard and
  answer overload with an HTML error page under HTTP 200. Three mirrors are tried in
  order, the body is checked for JSON rather than the status code, and any failure
  leaves the layer empty with no toast. A missing camera layer is a disappointment; a
  crashed map is a broken app.
* **D-72. An empty result is not cached.** A throttled Overpass and a genuinely
  camera-free road both return zero rows, and treating the first as the second would
  hide cameras for the rest of the drive.
* **D-73. The query is a corridor, not a bounding box.** `around:250` along a route
  sampled to 120 points. For an L-shaped route the bounding box is many times the area,
  and Overpass charges by the work it does.
* **D-74. Cameras may be shown without locking.** They are static, so withholding them
  until the lock buys nothing. Locking still fetches them alongside incidents.
* **D-75. The lock hides the route hint but not the location button** (supersedes the
  blanket `!isRouteLocked` gate on that band). The hint is about editing a route, which
  the lock forbids; where the device is stays worth knowing while driving.

### Acceptance Criteria

* AC-730: a 5000-point route samples to 120, keeping both ends, evenly spaced.
* AC-731: the query asks for both `highway=speed_camera` and `enforcement=maxspeed`.
* AC-732: the query is an `around:` corridor and sends coordinates lat,lon.
* AC-733: parsed coordinates are lon,lat, matching the rest of the app.
* AC-734: a missing limit is null and renders no label; an mph limit converts to km/h.
* AC-735: a node matching both tag queries is de-duplicated.
* AC-736: a new or changed route fetches; an unchanged one does not.
* AC-737: the manual refresh ignores the cache.
* AC-738: switching cameras on fetches without waiting for a lock.
* AC-739: an Overpass failure leaves the layer empty, raises no toast, and does not
  disturb the route.
* AC-740: an empty result is not cached, so the next lock retries.
* AC-741: toggling cameras off clears the layer and the cache.
* AC-742: the location button survives the route lock; the hint does not.

Verify: `tests/cameras.test.ts` (60), `tests/layout.test.ts` (123).

### Failure Behavior

| Situation | Expected |
|---|---|
| All Overpass mirrors down | Layer empty, no toast, retried on the next lock |
| Overpass returns HTML under HTTP 200 | Treated as a failure, next mirror tried |
| Overpass returns zero cameras | Not cached; retried rather than trusted |
| Node with no coordinate | Dropped |
| `maxspeed` unparseable (`walk`, `RU:urban`) | Camera shown, no label |
| No route | No request |

### Known Risks

* **OSM camera coverage is community-mapped and uneven,** and a camera that is not
  mapped is not shown. This is a hint, never a guarantee.
* **Public Overpass is not a production dependency.** It rate-limited during development
  within a handful of queries. If the layer proves useful, the data should be baked into
  a tileset or self-hosted rather than fetched live.
* **Tag sampling was not verified against live Overpass output.** The count query
  succeeded (28 nodes in central Kyiv) but body queries were throttled before a sample
  could be read, so the parser is written against the documented OSM schema and is
  tolerant of every optional field rather than relying on any of them.

## 46. Overlay Defaults

* **D-76. A layer is on by default when showing it costs nothing per use.** Congestion
  rides map tiles that are fetched anyway and cameras come from keyless OSM, so both
  start on; TomTom incidents are metered against a daily quota and start off. The rule is
  cost, not usefulness: a metered layer should be a decision, a free one should not have
  to be discovered through a menu.
* **D-77. Defaults are read against the default, not against `=== true`.** A settings
  blob written before these keys existed would otherwise be silently forced off, so a
  default-on rollout would reach nobody who had ever opened the app. An explicitly stored
  `false` is a choice and is still honoured.
* **D-78. Cameras fetch when the route is built,** not only on lock. Being on by default
  is meaningless if the data waits for a lock that may never come. The fetch is still
  gated on the layer being on and the route having changed.

### Acceptance Criteria

* AC-743: a fresh install and an older settings blob both show congestion and cameras and
  leave incidents off; unrelated stored preferences survive.
* AC-744: a layer switched off by hand stays off across the default change.

Verify: `tests/cameras.test.ts` (67), `tests/traffic.test.ts` (90).

### Note on counting requests in tests

`tests/plan.test.ts` and `tests/draw.test.ts` count Directions requests by URL rather
than counting every `fetch`. Cameras being on by default means a route build now also
issues an Overpass request, and an unfiltered counter no longer measures what those
suites assert.

## 47. Manual Refresh

* **D-79. The refresh control is always rendered,** rather than appearing only with the
  incidents layer on. It was hidden behind the state of one layer, which is exactly when
  it is hardest to find, and it now refreshes incidents and cameras together: to the
  driver there is one set of traffic data, not two schedules. Each half is individually
  gated, so a layer that is off or a missing key simply does nothing. It stays disabled
  with no route, because both fetches are scoped to the route.

* AC-745: the refresh is present with both layers off, with no TomTom key, and while
  locked; it is disabled only when there is no route.

Verify: `tests/cameras.test.ts` (71).

## 48. Error Presentation

* **D-80. Only messages this app wrote are ever shown.** `userFacingMessage` gates on
  type, not on truthiness: an error must descend from `AppError` for its text to be
  repeated. `error instanceof Error ? error.message : fallback` was the bug - a
  DOMException from the Bluetooth stack and a TypeError from a real defect are both
  `Error`, so the OBD path could put "Cannot read properties of undefined (reading
  'server')" in front of a driver. `DirectionsError`, `GeocodingError`, `TrafficError`
  and the new `ObdError` all descend from `AppError`.
* **D-81. A content filter backs the type gate.** `isUserSafeMessage` rejects stack
  frames, file:line pairs, error class names, property paths, UUIDs, AT commands and raw
  PIDs, `null`/`undefined`/`NaN` leaking through a template, and anything multi-line or
  over 160 characters. It applies to our own messages too, because the leak that
  prompted this was an authored string: `No reply to ${command} within ${timeoutMs} ms.`
  put the raw ELM327 command on screen. That message is now
  "The adapter stopped responding."
* **D-82. Toasts are opaque fills, not tints.** A 15% red wash over a live map was
  legible against dark tiles and invisible against bright ones. An error is the one
  message that must never be missed, so it is a solid fill with white text, a ring and a
  drop shadow, and it carries `role="alert"` rather than `role="status"`. Inline panel
  errors share `INLINE_ERROR`, a tinted chip, in place of thin `text-red-400`.

### Acceptance Criteria

* AC-750: every app error class descends from `AppError` and reaches the driver.
* AC-751: a plain Error, TypeError, thrown string, object, null or undefined is replaced
  by the authored fallback; so are the specific strings Web Bluetooth throws.
* AC-752: the content filter catches stack frames, file:line, class names, property
  paths, UUIDs, AT commands, PIDs, `undefined`/`NaN` in templates, `[object Object]`,
  arrow functions, native-code markers, empty, multi-line and overlong strings.
* AC-753: an `AppError` whose message is code-shaped still falls back.
* AC-754: all 24 authored messages in the app pass the filter.
* AC-755: the error toast is an opaque fill with white text, a shadow and `role="alert"`;
  a non-error stays `role="status"`.

Verify: `tests/errors.test.ts` (65), `tests/layout.test.ts` (129).

## 49. Menu and Settings Split

* **D-83. The three overlay toggles move to Settings.** They are configuration, set once
  and rarely changed, and the menu is for actions taken while using the map. Grouping
  them under one heading also lets each carry a line of explanation, which a menu row
  has no space for - and the cost difference between the free layers and the metered one
  is exactly the thing that needed explaining.
* **D-84. Refresh traffic stays in the menu.** It is an action, not a setting: it is
  taken in the moment, on the road, and burying it two taps deep in a modal would defeat
  the point of D-79 having just made it always available.
* **D-85. The reverse-route entry is removed.** The `reverseRoute` action is kept: it is
  covered by `store`, `lock` and `camera` suites and still works, it simply has no
  button. Deleting tested behaviour was not asked for; if the capability is meant to go,
  the action and those three suites' use of it go with it.

### Acceptance Criteria

* AC-760: Settings carries a Map overlays section with Traffic, Cameras and Incidents;
  the incident row is absent with no TomTom key while the free two remain.
* AC-761: the menu carries none of the three toggles and no reverse-route entry.
* AC-762: the menu keeps Refresh traffic.

Verify: `tests/cameras.test.ts` (81).

### Note

`vite.test.config.ts` now mirrors the app config's `__APP_BUILD__` define. Settings
renders the build stamp, so any suite rendering that panel failed on a bare
`ReferenceError` without it.

## 50. TomTom Key in Settings

* **D-86. The TomTom key resolves like the Mapbox token (FR-6.1):** what was saved in
  Settings wins over what was built into the bundle. Without this the key could only be
  changed by rebuilding, which is useless on a phone that is already installed to the
  Home Screen.
* **D-87. Validation is deliberately loose.** TomTom publishes no key format the way
  Mapbox does with `pk.`, so anything stricter than "not empty, no whitespace, plausible
  length" would be inventing a rule and rejecting valid keys. Whitespace is the one
  thing worth catching, because it is what copying from a web page produces.
* **D-88. Saving or clearing a key re-gates the incident surface.** `traffic.status` is
  decided at store creation, so without this a key saved in Settings would leave the
  layer reporting `unavailable` until the next reload. Clearing the key takes the layer
  down with it and forgets the remembered preference, rather than leaving it switched on
  with no source behind it.
* **D-89. An invalid stored key resolves to null rather than being sent.** A corrupted
  or hand-edited value would otherwise go out as a query parameter and come back 403.

### Acceptance Criteria

* AC-770: empty, whitespace-only, spaced, too-short and too-long keys are rejected; a
  32-character key is accepted, with surrounding whitespace tolerated.
* AC-771: a key saved in Settings wins over the environment and is trimmed; an invalid
  stored key resolves to null.
* AC-772: saving a key moves the surface from `unavailable` to `idle` and persists it.
* AC-773: clearing the key returns the surface to `unavailable`, switches the layer off,
  clears its data, forgets the preference, and leaves the toggle inert.
* AC-774: the key field is rendered in Settings whether or not a key is present.

Verify: `tests/traffic.test.ts` (111), `tests/cameras.test.ts` (84).

## 51. OBD Adapter Discovery (field findings)

Measured against a Konnwei KW906 on an iPhone, 2026-09-24.

* **D-90 [corrected]. The allowlist was not this adapter's problem.** The KW906 was
  later measured as using service `0000fff0`, which was in the allowlist from the start,
  so its services were always visible. The widened list and the Nordic UART entry remain
  worthwhile for other adapters, but the KW906 failure was entirely D-91. The earlier
  reading - that the error changing proved the allowlist had been the fault - was wrong:
  the message changed because one sentence had been split into two, not because
  discovery started working.

  The original note, still true in general:
  **the service allowlist is a first suspect, not the adapter.** Web Bluetooth
  returns only services named in `optionalServices` and offers no way to enumerate what
  a device actually has, so an unlisted service is indistinguishable from an adapter
  with no services at all. A native app has no allowlist, which is why the same KW906
  worked in MaxOBD while this app rejected it. Nordic UART and several vendor ranges
  were added; the original seven UUIDs were guesses that were never field-checked.
* **D-91. The serial bridge is two characteristics, not one.** `findSerialCharacteristic`
  required a single characteristic carrying both `notify` and a write property. That is
  the minority arrangement: Nordic UART splits them (`6e400002` writes, `6e400003`
  notifies) and the 16-bit vendor services most ELM327 clones copy do the same. The
  KW906 was rejected as having "no readable data channel" for exactly this reason.
  `findSerialChannel` now returns a read end and a write end, preferring a combined
  characteristic where one exists so a control characteristic is not paired by mistake.
* **D-92. Write-without-response is used only where advertised.** Previously it was used
  whenever the method existed, which it does on every characteristic; a bridge
  advertising only `write` would reject the call.
* **D-93. Discovery is logged to the console, never to the screen.** D-80 keeps
  implementation detail out of the interface, but that left an allowlist miss and a real
  incompatibility looking identical to anyone reporting a problem. The device name, each
  visible service and every characteristic with its properties now print to the console,
  and the two failures carry different on-screen sentences.

### Acceptance Criteria

* AC-780: a Nordic UART layout, and a split 16-bit vendor layout, are both accepted with
  the right end assigned to each direction.
* AC-781: a combined notify-and-write characteristic is preferred over pairing.
* AC-782: notify alone, write alone, read-only, and an empty service are all rejected.

Verify: `tests/obd-protocol.test.ts` (45).

### Still unverified

Whether the KW906 then answers `ATZ` and the mode 01 PIDs. Discovery is only the first
gate; the ELM327 conversation past it has never run against real hardware.

## 52. Odometer Confirmation Probe

* **D-94. The support bitmap is confirmed by asking the car directly.** Revises AC-602,
  which forbade sending `01A6` unless the `01A0` bitmap advertised it. The bitmap is what
  the ECU claims, and some answer PIDs they never advertise; `01A6` was only added in SAE
  J1979-2 and is rare enough that the claim is worth a second opinion. One command at
  connect settles it for a given car.
* **D-95. The hazard the original rule guarded against is untouched.** A reply is
  believed only when it decodes as four data bytes. `NO DATA`, `?` and the rest are
  filtered before decoding and yield null, so an unanswered probe still means no odometer
  and can never be mistaken for a reading of zero, which would anchor the cursor to the
  route start.
* **D-96. The probe is skipped when the bitmap already says yes,** so a car with a
  properly advertised odometer spends no extra command; and skipped when `0100` went
  unanswered, because nothing is talking and the probe would only add a timeout to a
  connection that is already degraded.
* **D-97. `InitResult.odometerSource` records how it was decided** - `bitmap`, `probe`
  or `none` - so the case the bitmap alone would have got wrong is visible in tests.

### Acceptance Criteria

* AC-602 [revised]: an unsupported odometer is still reported as unsupported, now with
  `odometerSource: 'none'`.
* AC-790: a car that answers `01A6` while not advertising it gets a working odometer,
  recorded as `probe`; the driver is not told it is missing.
* AC-791: an unanswered probe leaves the odometer off and uncalibrated.
* AC-792: an advertised odometer is taken at its word and spends no confirmation command.
* AC-793: a bus that ignores `0100` is not probed further.

Verify: `tests/obd-protocol.test.ts` (55), `tests/obd-store.test.ts` (41).

## 53. KW906 Field Measurement

Read from the adapter on 2026-09-24, via the console diagnostics of D-93.

```
device: KONNWEI
service 0000fff0-0000-1000-8000-00805f9b34fb
  char 0000fff1  notify=true  write=false  writeNoResponse=false
  char 0000fff2  notify=false write=false  writeNoResponse=true
```

This is the layout D-91 describes: the read and write ends are separate characteristics
and neither carries both properties. It is now a named regression case, AC-783, rather
than a hypothetical.

It also settles D-92: `fff2` advertises only `writeWithoutResponse`, so calling
`writeValue` on it would be rejected. The previous code happened to call the right method
for the wrong reason - it preferred without-response whenever the method existed, which is
always - and would have broken on an adapter that advertises only `write`.

Outstanding: the connection now succeeds and the odometer reports absent. Whether the
confirmation probe of D-94 changes that on this car, and whether speed tracks correctly
over a real drive, are both still unmeasured.
