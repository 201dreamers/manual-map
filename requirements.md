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
| **Screen Persistence** | **Web Wake Lock API integration**: Prevents the iPhone display from dimming or sleeping during active playback. |
| **Map Rendering** | 60 FPS vector map rendering and rotation using WebGL via Mapbox GL JS. |
| **Performance Safeguard** | Large coordinate arrays returned from APIs are automatically downsampled using Turf.js simplify algorithms to maintain high frame rates on mobile GPUs. |
| **Execution Context** | Foreground web tab execution. Simulation pauses if the browser tab is hidden or minimized. |
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
* **FR-5.1 Live Dashboard Display:** Shown as small independent floating cards over the map (remaining + ETA; distance + position). Current speed is displayed by the speed slider readout rather than duplicated in its own card:
  * Current Speed (km/h or mph) - shown on the speed slider
  * Distance Covered vs. Total Route Distance
  * Distance Remaining
  * Estimated Time to Arrival (ETA calculated at current speed setting)
  * Current Latitude and Longitude coordinates
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
| [ Route History ]   [ Token / Settings ]   [ Reverse ]  |  <- Top Action Bar
+---------------------------------------------------------+
| [ REM 29.8 km | ETA 29 min ]                            |  <- Floating telemetry cards
| [ 15.2/45.0 km | 50.4500, 30.5200 ]                     |     (wrap independently)
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
* **Safe Area Support:** Top bar and bottom controls account for iOS notch (`env(safe-area-inset-top)`) and home indicator (`env(safe-area-inset-bottom)`).

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
