import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { api } from '../../services/api';
import type { Task, TrackingLog } from '../../types';

const REFRESH_INTERVAL_MS = 5000;

type TaskTrackingMapProps = {
  task: Task;
  isProvider: boolean;
  latestLocation?: TrackingLog | null;
  pollLatest?: boolean;
};

type Coordinates = [number, number];
type RoadRoute = {
  coordinates: Coordinates[];
  distanceKm: number;
  durationMinutes: number;
};

function MapViewport({ points }: { points: Coordinates[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points, { padding: [32, 32], maxZoom: 15 });
    } else if (points.length === 1) {
      map.setView(points[0], 15);
    }
  }, [map, points]);

  return null;
}

function getTaskCoordinates(task: Task): Coordinates | null {
  const latitude = Number(task.siteLatitude ?? task.latitude);
  const longitude = Number(task.siteLongitude ?? task.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return [latitude, longitude];
}

function normalizeRoadRoute(value: unknown): RoadRoute | null {
  if (value == null) return null;
  if (typeof value !== 'object') {
    throw new Error('The road route response is invalid.');
  }

  const route = value as Record<string, unknown>;
  if (!Array.isArray(route.coordinates) || route.coordinates.length < 2
    || typeof route.distanceKm !== 'number' || !Number.isFinite(route.distanceKm)
    || typeof route.durationMinutes !== 'number' || !Number.isFinite(route.durationMinutes)) {
    throw new Error('The road route response is incomplete.');
  }

  const coordinates = (route.coordinates as unknown[]).map((value): Coordinates => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('The road route contains an invalid coordinate.');
    }

    const point = value as Record<string, unknown>;
    const latitude = point.latitude;
    const longitude = point.longitude;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('The road route contains an invalid coordinate.');
    }

    return [latitude, longitude];
  });

  return {
    coordinates,
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
  };
}

export const TaskTrackingMap: React.FC<TaskTrackingMapProps> = ({
  task,
  isProvider,
  latestLocation,
  pollLatest = true,
}) => {
  const [latest, setLatest] = useState<TrackingLog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [siteLocationError, setSiteLocationError] = useState<string | null>(null);
  const [siteAddress, setSiteAddress] = useState<string | null>(null);
  const [isLoadingSiteLocation, setIsLoadingSiteLocation] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [taskCoordinates, setTaskCoordinates] = useState<Coordinates | null>(() => getTaskCoordinates(task));
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routeRequestIdRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    setTaskCoordinates(getTaskCoordinates(task));
    setSiteAddress(null);
    setSiteLocationError(null);
    setIsLoadingSiteLocation(true);
    api.tracking.getTaskSiteLocation(String(task.id))
      .then((response) => {
        if (!mounted) return;
        const location = response.data || {};
        const coordinates = getTaskCoordinates({ ...task, ...location });
        setTaskCoordinates(coordinates);
        setSiteAddress(typeof location.siteAddress === 'string' ? location.siteAddress : null);
        setSiteLocationError(coordinates
          ? null
          : 'This task has no saved requester pin. Update the task location and confirm its map pin.');
        setIsLoadingSiteLocation(false);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setSiteAddress(null);
        const apiError = error as { response?: { data?: { message?: string } }; message?: string };
        setSiteLocationError(apiError.response?.data?.message || apiError.message || 'Unable to load requester task location.');
        setIsLoadingSiteLocation(false);
      });
    return () => {
      mounted = false;
    };
  }, [task]);

  const refreshLocation = useCallback(async () => {
    if (!pollLatest) {
      setLatest(latestLocation || null);
      setLoadError(null);
      setIsLoading(false);
      return;
    }
    try {
      const response = await api.tracking.getLatest(String(task.id));
      setLatest((response.data || null) as TrackingLog | null);
      setLoadError(null);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { message?: string } }; message?: string };
      setLoadError(apiError.response?.data?.message || apiError.message || 'Unable to load provider location.');
    } finally {
      setIsLoading(false);
    }
  }, [latestLocation, pollLatest, task.id]);

  useEffect(() => {
    void refreshLocation();
    if (!pollLatest) return;
    const timer = window.setInterval(() => void refreshLocation(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pollLatest, refreshLocation]);

  const providerCoordinates = useMemo<Coordinates | null>(() => {
    if (!latest) return null;
    const latitude = Number(latest.lat);
    const longitude = Number(latest.lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      ? [latitude, longitude]
      : null;
  }, [latest]);
  const routeOriginLatitude = providerCoordinates?.[0];
  const routeOriginLongitude = providerCoordinates?.[1];
  const routeDestinationLatitude = taskCoordinates?.[0];
  const routeDestinationLongitude = taskCoordinates?.[1];
  useEffect(() => {
    if (routeOriginLatitude == null || routeOriginLongitude == null
      || routeDestinationLatitude == null || routeDestinationLongitude == null) {
      setRoadRoute(null);
      setRouteError(null);
      return;
    }

    const requestId = ++routeRequestIdRef.current;
    api.tracking.getRoute(String(task.id))
      .then((response) => {
        if (requestId !== routeRequestIdRef.current) return;
        const route = normalizeRoadRoute(response.data);
        if (!route) {
          setRoadRoute(null);
          setRouteError(null);
          return;
        }
        setRoadRoute(route);
        setRouteError(null);
      })
      .catch((error: unknown) => {
        if (requestId !== routeRequestIdRef.current) return;
        const apiError = error as { response?: { data?: { message?: string } }; message?: string } | null;
        setRoadRoute(null);
        setRouteError(apiError?.response?.data?.message || apiError?.message || 'Unable to update the road route.');
      });

    return () => {
      if (routeRequestIdRef.current === requestId) routeRequestIdRef.current += 1;
    };
  }, [
    routeDestinationLatitude,
    routeDestinationLongitude,
    routeOriginLatitude,
    routeOriginLongitude,
    task.id,
  ]);
  const points = useMemo(
    () => [taskCoordinates, providerCoordinates, ...(roadRoute?.coordinates || [])]
      .filter((point): point is Coordinates => point !== null),
    [providerCoordinates, roadRoute, taskCoordinates]
  );
  const center = points[0] || [0, 0];

  return (
    <section className="rounded-2xl border border-dark-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-dark-900">Task live tracking</h2>
          <p className="mt-1 text-sm text-dark-600">
            {isProvider
              ? 'Your location and route are shown here.'
              : 'Follow the provider’s route to your task location.'}
          </p>
        </div>
        {isProvider && siteAddress && (
          <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-base text-blue-900">
            <span className="font-semibold">Requester task address:</span> {siteAddress}
          </p>
        )}
        {latest?.timestamp && (
          <span className="text-xs text-dark-500">
            Last update: {new Date(latest.timestamp).toLocaleTimeString()}
          </span>
        )}
        {latest?.source === 'DEMO' && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
            DEMO LOCATION: simulated, not live GPS
          </span>
        )}
      </div>

      <div className="h-80 overflow-hidden rounded-xl border border-dark-100">
        {points.length > 0 ? (
          <MapContainer center={center} zoom={14} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapViewport points={points} />
            {roadRoute && roadRoute.coordinates.length > 1 && (
              <Polyline
                positions={roadRoute.coordinates}
                pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.85 }}
              />
            )}
            {taskCoordinates && (
              <CircleMarker center={taskCoordinates} radius={10} pathOptions={{ color: '#15803d', fillColor: '#22c55e', fillOpacity: 0.9 }}>
                <Popup>Requester&apos;s task location</Popup>
              </CircleMarker>
            )}
            {providerCoordinates && (
              <CircleMarker center={providerCoordinates} radius={10} pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.9 }}>
                <Popup>
                  {latest?.source === 'DEMO'
                    ? 'Simulated provider location (DEMO)'
                    : "Provider's latest location"}
                </Popup>
              </CircleMarker>
            )}
          </MapContainer>
        ) : (
          <div className="flex h-full items-center justify-center bg-dark-50 px-5 text-center text-sm text-dark-600">
            {taskCoordinates
              ? 'Waiting for the provider to share a location from the mobile app.'
              : 'Task map coordinates are not available.'}
          </div>
        )}
      </div>

      {roadRoute && (
        <p className="mt-2 text-xs text-dark-600">
          Road route: {roadRoute.distanceKm.toFixed(1)} km, about {Math.round(roadRoute.durationMinutes)} min (no traffic data).
        </p>
      )}
      {routeError && <p role="alert" className="mt-2 text-sm text-red-700">{routeError}</p>}
      {loadError && <p role="alert" className="mt-3 text-sm text-red-700">{loadError}</p>}
      {siteLocationError && <p role="alert" className="mt-3 text-sm text-red-700">{siteLocationError}</p>}
      {!latest && isLoading && <p className="mt-3 text-sm text-dark-500">Loading provider location...</p>}
      {!taskCoordinates && !isLoadingSiteLocation && !siteLocationError && (
        <p className="mt-2 text-xs text-dark-500">
          The task location cannot be shown on the map because precise coordinates were not provided.
        </p>
      )}
    </section>
  );
};
