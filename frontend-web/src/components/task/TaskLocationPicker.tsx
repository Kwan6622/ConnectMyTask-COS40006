import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export type TaskCoordinates = {
  latitude: number;
  longitude: number;
};

type TaskLocationPickerProps = {
  address: string;
  coordinates: TaskCoordinates | null;
  searchRequest: number;
  onCoordinatesChange: (coordinates: TaskCoordinates) => void;
};

type GeocodingResult = {
  lat: string;
  lon: string;
};

function MapViewport({ coordinates }: { coordinates: TaskCoordinates }) {
  const map = useMap();

  React.useEffect(() => {
    map.setView([coordinates.latitude, coordinates.longitude], 16);
  }, [coordinates, map]);

  return null;
}

function MapClickHandler({ onCoordinatesChange }: Pick<TaskLocationPickerProps, 'onCoordinatesChange'>) {
  useMapEvents({
    click: ({ latlng }) => onCoordinatesChange({ latitude: latlng.lat, longitude: latlng.lng }),
  });
  return null;
}

const locationIcon = L.divIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border:3px solid white;border-radius:50%;background:#2563eb;box-shadow:0 1px 5px #334155"></div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export function TaskLocationPicker({
  address,
  coordinates,
  searchRequest,
  onCoordinatesChange,
}: TaskLocationPickerProps): React.ReactElement {
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchingRef = useRef(false);
  const lastAutoSearchRef = useRef(0);
  const center = coordinates || { latitude: 10.7769, longitude: 106.7009 };
  const mapCenter = useMemo<[number, number]>(
    () => [center.latitude, center.longitude],
    [center.latitude, center.longitude]
  );

  const findAddress = useCallback(async (): Promise<void> => {
    const query = address.trim();
    if (!query) {
      setSearchError('Enter the task address first.');
      return;
    }

    if (searchingRef.current) return;
    searchingRef.current = true;
    setIsSearching(true);
    setSearchError('');
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'vn',
        q: `${query}, Vietnam`,
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!response.ok) throw new Error('Address lookup is temporarily unavailable.');
      const results = await response.json() as GeocodingResult[];
      const result = results[0];
      const latitude = Number(result?.lat);
      const longitude = Number(result?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('No map location was found for this address. Try adding the ward or district.');
      }
      onCoordinatesChange({ latitude, longitude });
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Unable to find this address on the map.');
    } finally {
      searchingRef.current = false;
      setIsSearching(false);
    }
  }, [address, onCoordinatesChange]);

  useEffect(() => {
    if (!searchRequest || lastAutoSearchRef.current === searchRequest) return;
    lastAutoSearchRef.current = searchRequest;
    void findAddress();
  }, [findAddress, searchRequest]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void findAddress()}
        disabled={isSearching}
        className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-60"
      >
        {isSearching ? 'Finding address...' : 'Find address on map'}
      </button>
      <p className="text-sm text-dark-500">
        {coordinates
          ? 'Check the pin. Click or drag it to correct the exact task location.'
          : 'Find the address to preview its location, then adjust the pin if needed.'}
      </p>
      {coordinates ? (
        <>
          <div className="h-72 overflow-hidden rounded-xl border border-dark-200">
            <MapContainer center={mapCenter} zoom={16} scrollWheelZoom className="h-full w-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapViewport coordinates={coordinates} />
              <MapClickHandler onCoordinatesChange={onCoordinatesChange} />
              <Marker
                position={[coordinates.latitude, coordinates.longitude]}
                icon={locationIcon}
                draggable
                eventHandlers={{
                  dragend: (event) => {
                    const position = event.target.getLatLng();
                    onCoordinatesChange({ latitude: position.lat, longitude: position.lng });
                  },
                }}
              />
            </MapContainer>
          </div>
          <p className="text-xs text-dark-500">
            Selected: {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}
          </p>
        </>
      ) : null}
      {searchError ? <p role="alert" className="text-sm text-red-600">{searchError}</p> : null}
    </div>
  );
}
