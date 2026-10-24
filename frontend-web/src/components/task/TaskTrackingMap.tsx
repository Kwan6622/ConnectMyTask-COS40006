import React, { useCallback, useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
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

export const TaskTrackingMap: React.FC<TaskTrackingMapProps> = ({
  task,
  isProvider,
  latestLocation,
  pollLatest = true,
}) => {
  const [latest, setLatest] = useState<TrackingLog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [siteLocationError, setSiteLocationError] = useState<string | null>(null);
  const [isLoadingSiteLocation, setIsLoadingSiteLocation] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [taskCoordinates, setTaskCoordinates] = useState<Coordinates | null>(() => getTaskCoordinates(task));

  useEffect(() => {
    let mounted = true;
    api.tracking.getTaskSiteLocation(String(task.id))
      .then((response) => {
        if (!mounted) return;
        const location = response.data || {};
        const coordinates = getTaskCoordinates({ ...task, ...location });
        setTaskCoordinates(coordinates);
        setSiteLocationError(coordinates
          ? null
          : 'This task has no saved requester pin. Update the task location and confirm its map pin.');
        setIsLoadingSiteLocation(false);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
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
  const points = useMemo(
    () => [taskCoordinates, providerCoordinates].filter((point): point is Coordinates => point !== null),
    [providerCoordinates, taskCoordinates]
  );
  const center = points[0] || [10.7769, 106.7009];

  return (
    <section className="rounded-2xl border border-dark-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-dark-900">Task live tracking</h2>
          <p className="mt-1 text-sm text-dark-600">
            {isProvider
              ? 'Your location is shared from the mobile app after you verify this task.'
              : 'Provider location refreshes automatically. You can view it on any device.'}
          </p>
        </div>
        {latest?.timestamp && (
          <span className="text-xs text-dark-500">
            Updated {new Date(latest.timestamp).toLocaleTimeString()}
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
            {taskCoordinates && (
              <CircleMarker center={taskCoordinates} radius={10} pathOptions={{ color: '#15803d', fillColor: '#22c55e', fillOpacity: 0.9 }}>
                <Popup>Requester&apos;s task location</Popup>
              </CircleMarker>
            )}
            {providerCoordinates && (
              <CircleMarker center={providerCoordinates} radius={10} pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.9 }}>
                <Popup>Provider&apos;s latest location</Popup>
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

      {loadError && <p role="alert" className="mt-3 text-sm text-red-700">{loadError}</p>}
      {siteLocationError && <p role="alert" className="mt-3 text-sm text-red-700">{siteLocationError}</p>}
      {!latest && isLoading && <p className="mt-3 text-sm text-dark-500">Loading provider location...</p>}
      {isLoadingSiteLocation && <p className="mt-2 text-xs text-dark-500">Loading requester task pin...</p>}
      {!taskCoordinates && !isLoadingSiteLocation && !siteLocationError && (
        <p className="mt-2 text-xs text-dark-500">
          The task location cannot be shown on the map because precise coordinates were not provided.
        </p>
      )}
    </section>
  );
};
