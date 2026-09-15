import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import { lerpBearing } from '../lib/geo';
import { useSimulationStore } from '../store/simulationStore';
import type { CoordinateTuple, TelemetryState } from '../types/domain';

const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';
const DEFAULT_CENTER: CoordinateTuple = [30.5234, 50.4501];
const DEFAULT_ZOOM = 12;
const TRACKING_ZOOM = 16;
/** Per-frame easing factor for map rotation: high enough to follow, low enough to stay smooth. */
const BEARING_SMOOTHING = 0.18;
/** Duration of the fit-to-route animation shown right after a route is calculated. */
const ROUTE_FIT_DURATION_MS = 600;

const SKETCH_SOURCE_ID = 'simulation-sketch';
const SKETCH_LAYER_ID = 'simulation-sketch-line';
const ROUTE_SOURCE_ID = 'simulation-route';
const ROUTE_CASING_LAYER_ID = 'simulation-route-casing';
const ROUTE_LINE_LAYER_ID = 'simulation-route-line';

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function createVehicleElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className =
    'flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/20 ring-2 ring-sky-400';
  element.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 20 21 12 16.8 4 21Z" fill="#0ea5e9" stroke="#f8fafc" stroke-width="1.5"
        stroke-linejoin="round" />
    </svg>`;
  return element;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const vehicleMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pointMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const appliedBearingRef = useRef(0);
  const hasTrackedOnceRef = useRef(false);
  const suppressClickUntilRef = useRef(0);

  const mapboxToken = useSimulationStore((state) => state.mapboxToken);

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

      renderRoute(map, useSimulationStore.getState().geometry?.coordinates ?? null);
    });

    const publishViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      useSimulationStore
        .getState()
        .setViewport([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
    };
    map.on('load', publishViewport);
    map.on('moveend', publishViewport);

    map.on('click', (event) => {
      if (useSimulationStore.getState().isDrawArmed) return;
      // A stroke ends with a synthetic click; ignore it so drawing never drops a pin.
      if (performance.now() < suppressClickUntilRef.current) return;
      void useSimulationStore
        .getState()
        .addRoutePoint([event.lngLat.lng, event.lngLat.lat] as CoordinateTuple);
    });

    // FR-4.3: any manual gesture suspends auto-centering and rotation.
    const handleUserGesture = (event: unknown) => {
      // Only gestures carry an originalEvent; camera moves driven by this app do not.
      if (!(event as { originalEvent?: unknown }).originalEvent) return;
      if (useSimulationStore.getState().config.cameraTrackingEnabled) {
        useSimulationStore.getState().setCameraTracking(false);
      }
    };
    map.on('dragstart', handleUserGesture);
    map.on('zoomstart', handleUserGesture);
    map.on('rotatestart', handleUserGesture);

    return () => {
      pointMarkersRef.current.forEach((marker) => marker.remove());
      pointMarkersRef.current = [];
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      hasTrackedOnceRef.current = false;
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
        return new mapboxgl.Marker({ color, scale: 0.8 })
          .setLngLat(point.coordinate)
          .addTo(map);
      });
    };

    render(useSimulationStore.getState().routePoints);
    return useSimulationStore.subscribe((state) => state.routePoints, render);
  }, []);

  // High-frequency telemetry -> marker placement and heading-up camera, without React re-renders.
  useEffect(() => {
    const apply = (telemetry: TelemetryState) => {
      const map = mapRef.current;
      if (!map) return;

      const coordinate = telemetry.currentCoordinate;
      if (!coordinate) {
        vehicleMarkerRef.current?.remove();
        vehicleMarkerRef.current = null;
        return;
      }

      if (!vehicleMarkerRef.current) {
        vehicleMarkerRef.current = new mapboxgl.Marker({
          element: createVehicleElement(),
          rotationAlignment: 'map',
        })
          .setLngLat(coordinate)
          .addTo(map);
      } else {
        vehicleMarkerRef.current.setLngLat(coordinate);
      }
      // The marker is map-aligned, so its on-screen angle is its rotation minus the
      // camera bearing. Feeding it the raw heading while the camera runs on the
      // smoothed one makes the arrow swing by exactly the lag between them, so both
      // read from the same smoothed value.
      const smoothedBearing = hasTrackedOnceRef.current
        ? lerpBearing(appliedBearingRef.current, telemetry.bearingDegrees, BEARING_SMOOTHING)
        : telemetry.bearingDegrees;
      appliedBearingRef.current = smoothedBearing;
      vehicleMarkerRef.current.setRotation(smoothedBearing);

      if (!useSimulationStore.getState().config.cameraTrackingEnabled) return;

      map.jumpTo({
        center: coordinate,
        bearing: smoothedBearing,
        zoom: hasTrackedOnceRef.current ? map.getZoom() : Math.max(map.getZoom(), TRACKING_ZOOM),
      });
      hasTrackedOnceRef.current = true;
    };

    apply(useSimulationStore.getState().telemetry);
    return useSimulationStore.subscribe((state) => state.telemetry, apply);
  }, []);

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
