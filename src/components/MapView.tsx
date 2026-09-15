import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef } from 'react';
import { lerpZoom, steppedZoom, trackingPadding, ZOOM_SMOOTHING } from '../lib/camera';
import { isWithinTapRadius, lerpBearing, projectOntoRoute } from '../lib/geo';
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
/** Short enough to feel like a button press, long enough not to jolt the map. */
const ZOOM_EASE_DURATION_MS = 250;

const SKETCH_SOURCE_ID = 'simulation-sketch';
const SKETCH_LAYER_ID = 'simulation-sketch-line';
const ROUTE_SOURCE_ID = 'simulation-route';
const ROUTE_CASING_LAYER_ID = 'simulation-route-casing';
const ROUTE_LINE_LAYER_ID = 'simulation-route-line';

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
function createVehicleElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className =
    'pointer-events-none absolute left-0 top-0 z-10 flex h-11 w-11 items-center ' +
    'justify-center rounded-full bg-sky-500/20 ring-2 ring-sky-400';
  element.style.willChange = 'transform';
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
  const vehicleElementRef = useRef<HTMLDivElement | null>(null);
  const vehiclePoseRef = useRef<{ coordinate: CoordinateTuple; bearingDegrees: number } | null>(
    null,
  );
  const pointMarkersRef = useRef<mapboxgl.Marker[]>([]);
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
              padding: trackingPadding(map.getContainer().clientHeight),
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
          padding: trackingPadding(map.getContainer().clientHeight),
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
            padding: trackingPadding(map.getContainer().clientHeight),
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
