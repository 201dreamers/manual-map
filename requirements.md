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
| **Route Source** | Interactive Mapbox route builder (Start, Destination, Waypoints). | GPX file import (parsing tracks/timestamps) & GPX export. |
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
* **FR-4.2 Continuous Auto-Centering:** The map camera stays centered on the vehicle marker during automated playback.
* **FR-4.3 Manual Drag Override:** If the user manually drags or zooms the map during playback, camera auto-centering and rotation temporarily disable. A floating "Recenter" button appears to allow the user to re-enable camera tracking.

### 4.5 Telemetry & History Management
* **FR-5.1 Live Dashboard Display:** Shown as small independent floating cards over the map (speed; remaining + ETA; distance + position):
  * Current Speed (km/h or mph)
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
| [ 60 km/h ] [ REM 29.8 km | ETA 29 min ]                |  <- Floating telemetry cards
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
