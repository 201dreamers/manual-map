import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef } from 'react';
import {
  lerpZoom,
  MIN_VEHICLE_BOTTOM_CLEARANCE,
  steppedZoom,
  trackingPadding,
  ZOOM_SMOOTHING,
} from '../lib/camera';
import { isWithinTapRadius, lerpBearing, projectOntoRoute } from '../lib/geo';
import { useSimulationStore } from '../store/simulationStore';
import {
  incidentPointsToGeoJSON,
  incidentsToGeoJSON,
  type TrafficIncident,
} from '../lib/traffic';
import { camerasToGeoJSON, OSM_ATTRIBUTION, type SpeedCamera } from '../lib/cameras';
import type { CoordinateTuple, TelemetryState } from '../types/domain';

const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';
const DEFAULT_CENTER: CoordinateTuple = [30.5234, 50.4501];
const DEFAULT_ZOOM = 12;
const TRACKING_ZOOM = 16;
/** Close enough to recognise the street the fix landed on, without losing context. */
const LOCATION_FOCUS_ZOOM = 15;
/** Per-frame easing factor for map rotation: high enough to follow, low enough to stay smooth. */
const BEARING_SMOOTHING = 0.18;
/** Duration of the fit-to-route animation shown right after a route is calculated. */
const ROUTE_FIT_DURATION_MS = 600;
/** Short enough to feel like a button press, long enough not to jolt the map. */
const ZOOM_EASE_DURATION_MS = 250;

const SKETCH_SOURCE_ID = 'simulation-sketch';
const SKETCH_LAYER_ID = 'simulation-sketch-line';
const ROUTE_SOURCE_ID = 'simulation-route';
const ROUTE_CASING_LAYER_ID = 'simulation-route-casing';
const ROUTE_LINE_LAYER_ID = 'simulation-route-line';

const CONGESTION_SOURCE_ID = 'mapbox-traffic';
const CONGESTION_LAYER_ID = 'traffic-congestion';
const INCIDENT_SOURCE_ID = 'traffic-incidents';
/**
 * Separate from the geometry source rather than filtered out of it: most incidents come
 * back as a LineString, so a `geometry-type == Point` filter over the geometry source
 * would silently drop a symbol for every one of them.
 */
const INCIDENT_POINT_SOURCE_ID = 'traffic-incident-points';
const INCIDENT_LINE_LAYER_ID = 'traffic-incidents-line';
const INCIDENT_POINT_LAYER_ID = 'traffic-incidents-point';
const CAMERA_SOURCE_ID = 'speed-cameras';
const CAMERA_LAYER_ID = 'speed-cameras-point';
const CAMERA_LABEL_LAYER_ID = 'speed-cameras-label';

/**
 * Mapbox's own traffic tileset, included with the map tiles the app already loads: no
 * extra request, no key beyond the one in use, and it caches like any other tile.
 */
const CONGESTION_TILESET = 'mapbox://mapbox.mapbox-traffic-v1';

/**
 * Four buckets, coloured by how much they should change a decision. `low` is drawn at
 * all rather than filtered out, because its absence is what makes the other three
 * legible as a comparison instead of as isolated red smears.
 */
const CONGESTION_COLOR: mapboxgl.ExpressionSpecification = [
  'match',
  ['get', 'congestion'],
  'low',
  '#22c55e',
  'moderate',
  '#f59e0b',
  'heavy',
  '#ef4444',
  'severe',
  '#991b1b',
  'transparent',
];

/** Thin enough at city zooms to sit beside the road casing rather than swallow it. */
const CONGESTION_WIDTH: mapboxgl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  9,
  1.5,
  14,
  3,
  18,
  6,
];

const INCIDENT_COLOR: mapboxgl.ExpressionSpecification = [
  'match',
  ['get', 'group'],
  'blocking',
  '#ef4444',
  'slow',
  '#f59e0b',
  'weather',
  '#38bdf8',
  '#94a3b8',
];

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * The vehicle is placed by hand rather than through mapboxgl.Marker: Marker rounds
 * its screen position to whole pixels (`this._pos = this._pos.round()`), so against
 * the sub-pixel GL canvas the arrow visibly jitters in place while the camera
 * follows it. Projecting unrounded keeps it still.
 */
/**
 * The device's own position: a small blue disc with an arrow that only appears once a
 * direction is actually known. Kept visually distinct from the vehicle cursor, which is
 * a simulated position along a planned route - the two mean different things and must
 * never be mistaken for each other.
 */
function createUserLocationElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'relative flex h-5 w-5 items-center justify-center';
  element.innerHTML = `
    <span class="absolute inset-0 rounded-full bg-sky-400/25"></span>
    <span class="absolute inset-[3px] rounded-full bg-sky-400 ring-2 ring-white/90"></span>
    <svg data-arrow width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
         class="absolute -top-[9px]" style="display:none">
      <path d="M5 0 9 8 5 6 1 8Z" fill="#38bdf8" stroke="#f8fafc" stroke-width="1"
            stroke-linejoin="round" />
    </svg>
  `;
  return element;
}

function createVehicleElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className =
    'pointer-events-none absolute left-0 top-0 z-[1] flex h-11 w-11 items-center ' +
    'justify-center rounded-full bg-sky-500/20 ring-2 ring-sky-400';
  element.style.willChange = 'transform';
  element.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 20 21 12 16.8 4 21Z" fill="#0ea5e9" stroke="#f8fafc" stroke-width="1.5"
        stroke-linejoin="round" />
    </svg>`;
  return element;
}

/** Breathing room between the marker and the top edge of the control cluster. */
const CLUSTER_MARGIN_PX = 16;

/**
 * How much of the bottom of the map the floating controls actually occupy, read from
 * the custom property `ControlPanel` measures itself into. Falls back to the constant
 * when nothing has published a height yet - during the first paint, or under the
 * headless suites, where there is no layout to measure.
 */
function clusterClearance(): number {
  if (typeof document === 'undefined') return MIN_VEHICLE_BOTTOM_CLEARANCE;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    '--control-cluster-height',
  );
  const measured = Number.parseFloat(raw);
  return Number.isFinite(measured) && measured > 0
    ? measured + CLUSTER_MARGIN_PX
    : MIN_VEHICLE_BOTTOM_CLEARANCE;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const vehicleElementRef = useRef<HTMLDivElement | null>(null);
  const vehiclePoseRef = useRef<{ coordinate: CoordinateTuple; bearingDegrees: number } | null>(
    null,
  );
  const pointMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const appliedBearingRef = useRef(0);
  const hasTrackedOnceRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  /**
   * The zoom the tracking loop is easing towards. Null until the camera has locked
   * on once, after which every tracking frame drives the zoom from here.
   */
  const zoomTargetRef = useRef<number | null>(null);

  const mapboxToken = useSimulationStore((state) => state.mapboxToken);

  /**
   * Projects the vehicle to screen space without rounding, then rotates it about its
   * own centre. Runs on every rendered frame so it stays glued while panning.
   */
  const placeVehicle = useCallback(() => {
    const map = mapRef.current;
    const element = vehicleElementRef.current;
    const pose = vehiclePoseRef.current;
    if (!map || !element || !pose) return;

    const point = map.project(pose.coordinate);
    const rotation = pose.bearingDegrees - map.getBearing();
    element.style.transform =
      `translate(-50%, -50%) translate(${point.x}px, ${point.y}px) rotate(${rotation}deg)`;
  }, []);

  // Map lifecycle: recreated only when the access token changes.
  useEffect(() => {
    if (!mapboxToken || !containerRef.current) return;

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      pitch: 0,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      /*
        Added before the route layers, so the planned route and the sketch always paint
        over the traffic rather than being buried by a severe-congestion band running
        along the same street. Both start hidden and are revealed by the toggles: an
        added-then-hidden layer costs nothing, and adding them here keeps all layer
        creation in the one place that is guaranteed to run after the style loads.
      */
      map.addSource(CONGESTION_SOURCE_ID, { type: 'vector', url: CONGESTION_TILESET });
      map.addLayer({
        id: CONGESTION_LAYER_ID,
        type: 'line',
        source: CONGESTION_SOURCE_ID,
        'source-layer': 'traffic',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': CONGESTION_COLOR,
          'line-width': CONGESTION_WIDTH,
          'line-opacity': 0.85,
        },
      });

      map.addSource(INCIDENT_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: INCIDENT_LINE_LAYER_ID,
        type: 'line',
        source: INCIDENT_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': INCIDENT_COLOR, 'line-width': 6, 'line-opacity': 0.55 },
      });

      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0c4a6e', 'line-width': 11, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: ROUTE_LINE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 5 },
      });

      map.addSource(SKETCH_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: SKETCH_LAYER_ID,
        type: 'line',
        source: SKETCH_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#fbbf24',
          'line-width': 4,
          'line-dasharray': [1.5, 1],
        },
      });

      /*
        The incident symbols are the one traffic layer that sits above the route: they
        mark something to avoid, and a marker hidden under the line it applies to is
        worse than not drawing it. Points only - the geometry is already drawn beneath.
      */
      map.addSource(INCIDENT_POINT_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addLayer({
        id: INCIDENT_POINT_LAYER_ID,
        type: 'circle',
        source: INCIDENT_POINT_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 7, 18, 10],
          'circle-color': INCIDENT_COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f8fafc',
        },
      });

      /*
        Speed cameras: a white-ringed grey disc carrying the posted limit, drawn above
        everything else in the traffic family. The camera is a fixed point you either
        see in time or do not, so it must never be the thing hidden under a line.

        The source carries the OSM attribution rather than the layer, which is how
        Mapbox surfaces it in the attribution control - ODbL requires it.
      */
      map.addSource(CAMERA_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
        attribution: OSM_ATTRIBUTION,
      });
      map.addLayer({
        id: CAMERA_LAYER_ID,
        type: 'circle',
        source: CAMERA_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 9, 18, 13],
          'circle-color': '#1e293b',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#f8fafc',
        },
      });
      map.addLayer({
        id: CAMERA_LABEL_LAYER_ID,
        type: 'symbol',
        source: CAMERA_SOURCE_ID,
        // Only where OSM records a limit; the parser leaves the rest an empty string.
        filter: ['!=', ['get', 'maxspeed'], ''],
        layout: {
          visibility: 'none',
          'text-field': ['get', 'maxspeed'],
          'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 12],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#f8fafc' },
      });

      renderRoute(map, useSimulationStore.getState().geometry?.coordinates ?? null);
    });

    const publishViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      useSimulationStore
        .getState()
        .setViewport(
          [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          map.getZoom(),
        );
    };
    map.on('load', publishViewport);
    map.on('moveend', publishViewport);

    map.on('click', (event) => {
      const state = useSimulationStore.getState();
      if (state.isDrawArmed) return;
      // A stroke ends with a synthetic click; ignore it so drawing never drops a pin.
      if (performance.now() < suppressClickUntilRef.current) return;

      const tapped = [event.lngLat.lng, event.lngLat.lat] as CoordinateTuple;

      // D-4: locking turns the map from an editor into a steering surface - a tap
      // moves the marker along the route instead of adding a stop.
      if (state.isRouteLocked) {
        const geometry = state.geometry;
        if (!geometry) return;

        const snapped = projectOntoRoute(geometry.line, tapped);
        // The snap itself is metric; only the accept/reject test is in pixels, so a
        // stray thumb cannot drag the marker across the map (AC-508).
        if (!snapped || !isWithinTapRadius(event.point, map.project(snapped.coordinate))) {
          state.pushToast('info', 'Tap the route to move the marker.');
          return;
        }

        state.moveCursorTo(snapped.distanceMeters);
        return;
      }

      void state.addRoutePoint(tapped);
    });

    // FR-4.3: a manual pan or rotate suspends auto-centering and rotation.
    const handleUserGesture = (event: unknown) => {
      // Only gestures carry an originalEvent; camera moves driven by this app do not.
      if (!(event as { originalEvent?: unknown }).originalEvent) return;
      if (useSimulationStore.getState().config.cameraTrackingEnabled) {
        useSimulationStore.getState().setCameraTracking(false);
      }
    };
    map.on('dragstart', handleUserGesture);
    map.on('rotatestart', handleUserGesture);

    // A pinch changes the zoom directly, so the tracking target follows it live.
    // Without this the next tracking frame would ease straight back to the old zoom.
    map.on('zoom', (event) => {
      if (!(event as { originalEvent?: unknown }).originalEvent) return;
      zoomTargetRef.current = map.getZoom();
    });
    // D-7: zoom is deliberately absent. Widening the view to see the road ahead is
    // not a request to stop following the vehicle, so a pinch keeps tracking alive.
    // The pinch's rotation half is suppressed separately while tracking, otherwise
    // it would fight the heading-up camera on the very next frame.

    return () => {
      pointMarkersRef.current.forEach((marker) => marker.remove());
      pointMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      hasTrackedOnceRef.current = false;
      zoomTargetRef.current = null;
    };
  }, [mapboxToken]);

  // Route geometry -> line layer.
  useEffect(() => {
    const unsubscribe = useSimulationStore.subscribe(
      (state) => state.geometry,
      (geometry) => {
        const map = mapRef.current;
        if (!map) return;
        // Draw the new line but leave the camera alone: editing a route should not
        // yank the view back to the start. Recenter is offered instead (FR-4.3).
        hasTrackedOnceRef.current = false;
        renderRoute(map, geometry?.coordinates ?? null);
      },
    );
    return unsubscribe;
  }, []);

  /*
    Layer visibility follows the two toggles. Guarded on `getLayer`, because the store
    can be toggled before the style has finished loading - on a cold start with the
    overlay remembered from the last session, that is the normal case rather than a
    corner one.
  */
  useEffect(() => {
    const applyVisibility = (layerId: string, visible: boolean) => {
      const map = mapRef.current;
      if (!map || !map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    };

    const applyCongestion = (on: boolean) => applyVisibility(CONGESTION_LAYER_ID, on);
    const applyCameras = (on: boolean) => {
      applyVisibility(CAMERA_LAYER_ID, on);
      applyVisibility(CAMERA_LABEL_LAYER_ID, on);
    };
    const applyIncidents = (on: boolean) => {
      applyVisibility(INCIDENT_LINE_LAYER_ID, on);
      applyVisibility(INCIDENT_POINT_LAYER_ID, on);
    };

    const state = useSimulationStore.getState();
    // The style may not be up yet on first mount; `load` replays both.
    const replay = () => {
      const current = useSimulationStore.getState().traffic;
      applyCongestion(current.isCongestionOn);
      applyIncidents(current.isIncidentsOn);
      applyCameras(current.isCamerasOn);
    };
    applyCongestion(state.traffic.isCongestionOn);
    applyIncidents(state.traffic.isIncidentsOn);
    applyCameras(state.traffic.isCamerasOn);
    mapRef.current?.on('load', replay);

    const unsubscribe = useSimulationStore.subscribe(
      (s) =>
        [s.traffic.isCongestionOn, s.traffic.isIncidentsOn, s.traffic.isCamerasOn] as const,
      ([congestion, incidents, cameras]) => {
        applyCongestion(congestion);
        applyIncidents(incidents);
        applyCameras(cameras);
      },
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] },
    );
    return () => {
      mapRef.current?.off('load', replay);
      unsubscribe();
    };
  }, []);

  // Incident geometry and its symbols share one fetch, so they update together.
  useEffect(() => {
    const render = (incidents: TrafficIncident[]) => {
      const map = mapRef.current;
      if (!map) return;
      const geometry = map.getSource(INCIDENT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      const points = map.getSource(INCIDENT_POINT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      geometry?.setData(incidentsToGeoJSON(incidents));
      points?.setData(incidentPointsToGeoJSON(incidents));
    };
    return useSimulationStore.subscribe((state) => state.traffic.incidents, render);
  }, []);

  useEffect(() => {
    const render = (cameras: SpeedCamera[]) => {
      const source = mapRef.current?.getSource(CAMERA_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;
      source?.setData(camerasToGeoJSON(cameras));
    };
    return useSimulationStore.subscribe((state) => state.traffic.cameras, render);
  }, []);

  // AC-401: while the pen is armed the map stops panning and the drag draws instead.
  useEffect(() => {
    const applyArmed = (armed: boolean) => {
      const map = mapRef.current;
      if (!map) return;

      const gestures = [
        map.dragPan,
        map.dragRotate,
        map.touchZoomRotate,
        map.scrollZoom,
        map.doubleClickZoom,
        map.keyboard,
      ];
      for (const gesture of gestures) {
        if (armed) gesture.disable();
        else gesture.enable();
      }

      const canvas = map.getCanvasContainer();
      canvas.style.cursor = armed ? 'crosshair' : '';
      if (!armed) renderSketch(map, null);
    };

    applyArmed(useSimulationStore.getState().isDrawArmed);
    return useSimulationStore.subscribe((state) => state.isDrawArmed, applyArmed);
  }, []);

  // Stroke capture. Bound once; it only does work while the pen is armed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvasContainer();
    let stroke: CoordinateTuple[] | null = null;
    let pointerId: number | null = null;

    const toCoordinate = (event: PointerEvent): CoordinateTuple => {
      const rect = canvas.getBoundingClientRect();
      const point = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      return [point.lng, point.lat];
    };

    const finish = () => {
      if (!stroke) return;
      const drawn = stroke;
      stroke = null;
      pointerId = null;
      renderSketch(map, null);
      suppressClickUntilRef.current = performance.now() + 400;
      void useSimulationStore.getState().applyStroke(drawn);
    };

    const handleDown = (event: PointerEvent) => {
      if (!useSimulationStore.getState().isDrawArmed || pointerId !== null) return;
      event.preventDefault();
      pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      stroke = [toCoordinate(event)];
    };

    const handleMove = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== pointerId) return;
      event.preventDefault();
      stroke.push(toCoordinate(event));
      if (stroke.length > 1) renderSketch(map, stroke);
    };

    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      finish();
    };

    canvas.addEventListener('pointerdown', handleDown);
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    canvas.addEventListener('pointercancel', handleUp);

    return () => {
      canvas.removeEventListener('pointerdown', handleDown);
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerup', handleUp);
      canvas.removeEventListener('pointercancel', handleUp);
    };
  }, [mapboxToken]);

  // An explicit fit request frames the whole route, e.g. after loading from history.
  useEffect(
    () =>
      useSimulationStore.subscribe(
        (state) => state.fitRequestId,
        () => {
          const map = mapRef.current;
          const geometry = useSimulationStore.getState().geometry;
          if (!map || !geometry) return;
          fitRoute(map, geometry.coordinates);
        },
      ),
    [],
  );

  // A focus request flies to one coordinate. Used by the location seed, which is the
  // one case where placing a stop should take the camera with it - the whole point is
  // to show the driver where the fix landed.
  useEffect(
    () =>
      useSimulationStore.subscribe(
        (state) => state.focusRequest,
        (request) => {
          const map = mapRef.current;
          if (!map || !request.coordinate) return;
          map.flyTo({
            center: request.coordinate,
            zoom: Math.max(map.getZoom(), LOCATION_FOCUS_ZOOM),
            duration: 800,
          });
        },
      ),
    [],
  );

  // A north request rotates the camera upright without moving it.
  useEffect(
    () =>
      useSimulationStore.subscribe(
        (state) => state.northRequestId,
        () => {
          const map = mapRef.current;
          if (!map) return;
          appliedBearingRef.current = 0;
          map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
        },
      ),
    [],
  );

  // A zoom request steps the camera without disturbing what it is following.
  useEffect(
    () =>
      useSimulationStore.subscribe(
        (state) => state.zoomRequest,
        (request) => {
          const map = mapRef.current;
          if (!map || request.delta === 0) return;

          const from = zoomTargetRef.current ?? map.getZoom();
          const next = steppedZoom(from, request.delta, map.getMaxZoom());
          zoomTargetRef.current = next;

          // The ease always runs. While playing it is cut short by the next tracking
          // frame, which eases towards the same target, so the two agree. While paused
          // no tracking frame ever arrives - the loop is driven by telemetry, which is
          // static - so this ease is the only thing that applies the new zoom.
          const { config, telemetry } = useSimulationStore.getState();
          if (config.cameraTrackingEnabled && telemetry.currentCoordinate) {
            // Re-anchor while zooming, or the vehicle would drift off its anchor: an
            // ease without a centre zooms about the middle of the map, not about a
            // marker sitting three quarters down the screen.
            map.easeTo({
              center: telemetry.currentCoordinate,
              zoom: next,
              padding: trackingPadding(map.getContainer().clientHeight, clusterClearance()),
              retainPadding: false,
              duration: ZOOM_EASE_DURATION_MS,
            });
          } else {
            map.easeTo({ zoom: next, duration: ZOOM_EASE_DURATION_MS });
          }
        },
      ),
    [],
  );

  /**
   * A two-finger pinch carries a rotation component. While the camera is following
   * the vehicle that rotation is overwritten on the next frame anyway, so it is
   * suppressed rather than left to fight the heading-up bearing.
   */
  useEffect(() => {
    const applyTracking = (enabled: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      if (enabled) map.touchZoomRotate.disableRotation();
      else map.touchZoomRotate.enableRotation();
    };

    applyTracking(useSimulationStore.getState().config.cameraTrackingEnabled);
    return useSimulationStore.subscribe(
      (state) => state.config.cameraTrackingEnabled,
      applyTracking,
    );
  }, [mapboxToken]);

  // Tap points -> waypoint markers.
  useEffect(() => {
    const render = (points: { id: string; coordinate: CoordinateTuple }[]) => {
      const map = mapRef.current;
      if (!map) return;

      pointMarkersRef.current.forEach((marker) => marker.remove());
      pointMarkersRef.current = points.map((point, index) => {
        const isStart = index === 0;
        const isEnd = index === points.length - 1 && points.length > 1;
        const color = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#a855f7';
        // Pinned to the floor of the stack. Mapbox assigns markers a z-index of its
        // own for depth sorting, which let a pin dropped near a corner paint over the
        // menu and the thumb clusters. Nothing on the map may rise above the controls.
        const marker = new mapboxgl.Marker({ color, scale: 0.8 });
        marker.getElement().style.zIndex = '0';
        return marker
          .setLngLat(point.coordinate)
          .addTo(map);
      });
    };

    render(useSimulationStore.getState().routePoints);
    return useSimulationStore.subscribe((state) => state.routePoints, render);
  }, []);

  // The device's own position, drawn and removed with the toggle that owns it.
  useEffect(() => {
    const render = (location: { coordinate: CoordinateTuple; headingDegrees: number | null } | null) => {
      const map = mapRef.current;
      if (!map) return;

      if (!location) {
        userMarkerRef.current?.remove();
        userMarkerRef.current = null;
        return;
      }

      if (!userMarkerRef.current) {
        // rotationAlignment 'map' keeps the arrow pointing at a real-world bearing
        // while the camera rotates heading-up, instead of spinning with the screen.
        userMarkerRef.current = new mapboxgl.Marker({
          element: createUserLocationElement(),
          rotationAlignment: 'map',
        }).setLngLat(location.coordinate);
        userMarkerRef.current.getElement().style.zIndex = '0';
        userMarkerRef.current.addTo(map);
      } else {
        userMarkerRef.current.setLngLat(location.coordinate);
      }

      // No arrow until something can actually say which way you are facing: a fixed
      // arrow on an unknown heading is a confident lie.
      const arrow = userMarkerRef.current.getElement().querySelector<SVGElement>('[data-arrow]');
      if (arrow) arrow.style.display = location.headingDegrees === null ? 'none' : '';
      userMarkerRef.current.setRotation(location.headingDegrees ?? 0);
    };

    render(useSimulationStore.getState().userLocation);
    return useSimulationStore.subscribe((state) => state.userLocation, render);
  }, []);

  // High-frequency telemetry -> marker placement and heading-up camera, without React re-renders.
  useEffect(() => {
    const apply = (telemetry: TelemetryState) => {
      const map = mapRef.current;
      if (!map) return;

      const coordinate = telemetry.currentCoordinate;
      if (!coordinate) {
        vehicleElementRef.current?.remove();
        vehicleElementRef.current = null;
        vehiclePoseRef.current = null;
        return;
      }

      if (!vehicleElementRef.current) {
        vehicleElementRef.current = createVehicleElement();
        map.getContainer().appendChild(vehicleElementRef.current);
      }

      // The element is map-aligned, so its on-screen angle is its rotation minus the
      // camera bearing. Feeding it the raw heading while the camera runs on the
      // smoothed one makes the arrow swing by exactly the lag between them, so both
      // read from the same smoothed value.
      const smoothedBearing = hasTrackedOnceRef.current
        ? lerpBearing(appliedBearingRef.current, telemetry.bearingDegrees, BEARING_SMOOTHING)
        : telemetry.bearingDegrees;
      appliedBearingRef.current = smoothedBearing;
      vehiclePoseRef.current = { coordinate, bearingDegrees: smoothedBearing };

      if (useSimulationStore.getState().config.cameraTrackingEnabled) {
        // A tracking frame is a jumpTo, which stops animations, so an easeTo started
        // by the zoom buttons would die on the next frame. The target is eased here
        // instead, which is the only place that survives playback.
        let zoom: number;
        if (!hasTrackedOnceRef.current) {
          zoom = Math.max(map.getZoom(), TRACKING_ZOOM);
          zoomTargetRef.current = zoom;
        } else if (zoomTargetRef.current !== null) {
          zoom = lerpZoom(map.getZoom(), zoomTargetRef.current, ZOOM_SMOOTHING);
        } else {
          zoom = map.getZoom();
        }

        map.jumpTo({
          center: coordinate,
          bearing: smoothedBearing,
          zoom,
          // Anchors the vehicle below centre so the road ahead gets the screen.
          padding: trackingPadding(map.getContainer().clientHeight, clusterClearance()),
          retainPadding: false,
        });
        hasTrackedOnceRef.current = true;
      }

      placeVehicle();
    };

    // Panning and zooming move the vehicle on screen without any telemetry change.
    const map = mapRef.current;
    map?.on('render', placeVehicle);
    apply(useSimulationStore.getState().telemetry);
    const unsubscribe = useSimulationStore.subscribe((state) => state.telemetry, apply);
    return () => {
      map?.off('render', placeVehicle);
      unsubscribe();
      vehicleElementRef.current?.remove();
      vehicleElementRef.current = null;
    };
    // A new token rebuilds the map, so the render listener and the element that the
    // old container held have to be rebound to the new one.
  }, [placeVehicle, mapboxToken]);

  // Re-enabling tracking snaps the camera back onto the vehicle.
  useEffect(
    () =>
      useSimulationStore.subscribe(
        (state) => state.config.cameraTrackingEnabled,
        (enabled) => {
          const map = mapRef.current;
          const telemetry = useSimulationStore.getState().telemetry;
          if (!map || !enabled || !telemetry.currentCoordinate) return;

          appliedBearingRef.current = telemetry.bearingDegrees;
          hasTrackedOnceRef.current = true;
          map.easeTo({
            center: telemetry.currentCoordinate,
            bearing: telemetry.bearingDegrees,
            zoom: Math.max(map.getZoom(), TRACKING_ZOOM),
            // Recentring lands on the same anchor the tracking frames use, so the
            // marker does not jump to the middle and then drift back down.
            padding: trackingPadding(map.getContainer().clientHeight, clusterClearance()),
            retainPadding: false,
            duration: 450,
          });
        },
      ),
    [],
  );

  return <div ref={containerRef} className="absolute inset-0" />;
}

function renderSketch(map: mapboxgl.Map, coordinates: CoordinateTuple[] | null): void {
  const source = map.getSource(SKETCH_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (!source) return;

  source.setData(
    coordinates && coordinates.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
      : EMPTY_FEATURE_COLLECTION,
  );
}

function renderRoute(map: mapboxgl.Map, coordinates: CoordinateTuple[] | null): void {
  const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (!source) return;

  source.setData(
    coordinates
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
      : EMPTY_FEATURE_COLLECTION,
  );
}

function fitRoute(map: mapboxgl.Map, coordinates: CoordinateTuple[]): void {
  const bounds = coordinates.reduce(
    (acc, coordinate) => acc.extend(coordinate),
    new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map.fitBounds(bounds, { padding: 72, bearing: 0, duration: ROUTE_FIT_DURATION_MS, maxZoom: 15 });
}
