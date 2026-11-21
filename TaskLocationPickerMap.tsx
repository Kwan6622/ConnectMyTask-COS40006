import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { colors, radius } from "@/theme/tokens";

export type TaskCoordinates = {
  latitude: number;
  longitude: number;
};

type TaskLocationPickerMapProps = {
  coordinates: TaskCoordinates;
  onCoordinatesChange: (coordinates: TaskCoordinates) => void;
};

function createMapHtml(initialCoordinates: TaskCoordinates): string {
  const center = JSON.stringify([initialCoordinates.latitude, initialCoordinates.longitude]);
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;width:100%;margin:0;background:#e2e8f0}</style>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head><body><div id="map"></div><script>
if(window.L){
const map=L.map('map').setView(${center},16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const marker=L.marker(${center},{draggable:true}).addTo(map);
const sendPoint=function(point){window.ReactNativeWebView.postMessage(JSON.stringify({latitude:point.lat,longitude:point.lng}));};
map.on('click',function(event){marker.setLatLng(event.latlng);sendPoint(event.latlng);});
marker.on('dragend',function(){sendPoint(marker.getLatLng());});
window.setTaskLocation=function(latitude,longitude){const point=[latitude,longitude];marker.setLatLng(point);map.setView(point,Math.max(map.getZoom(),16));};
setTimeout(function(){map.invalidateSize();},250);
}
</script></body></html>`;
}

export function TaskLocationPickerMap({
  coordinates,
  onCoordinatesChange,
}: TaskLocationPickerMapProps): React.ReactElement {
  const mapRef = useRef<WebView<object> | null>(null);
  const [mapError, setMapError] = useState(false);
  const [html] = useState(() => createMapHtml(coordinates));

  useEffect(() => {
    mapRef.current?.injectJavaScript(
      `window.setTaskLocation(${coordinates.latitude},${coordinates.longitude}); true;`
    );
  }, [coordinates.latitude, coordinates.longitude]);

  const handleMessage = (event: WebViewMessageEvent): void => {
    let payload: unknown;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      setMapError(true);
      return;
    }
    if (
      typeof payload === "object"
      && payload !== null
      && "latitude" in payload
      && "longitude" in payload
      && typeof payload.latitude === "number"
      && typeof payload.longitude === "number"
      && Number.isFinite(payload.latitude)
      && Number.isFinite(payload.longitude)
      && payload.latitude >= -90 && payload.latitude <= 90
      && payload.longitude >= -180 && payload.longitude <= 180
    ) {
      onCoordinatesChange({ latitude: payload.latitude, longitude: payload.longitude });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.helper}>
        Check the pin. Tap the map or drag the pin to correct the exact task location.
      </Text>
      <View style={styles.mapFrame}>
        <WebView
          ref={mapRef}
          source={{ html }}
          style={styles.map}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
          onMessage={handleMessage}
          onLoadEnd={() => {
            mapRef.current?.injectJavaScript(
              `window.setTaskLocation(${coordinates.latitude},${coordinates.longitude}); true;`
            );
          }}
          onError={() => setMapError(true)}
        />
        {mapError ? (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorText}>Map could not load. Check your internet connection.</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.coordinates}>
        Selected: {coordinates.latitude.toFixed(6)}, {coordinates.longitude.toFixed(6)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  helper: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 17,
  },
  mapFrame: {
    height: 260,
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dark[200],
  },
  map: {
    flex: 1,
  },
  errorOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(226, 232, 240, 0.92)",
    padding: 16,
  },
  errorText: {
    color: colors.danger[600],
    fontSize: 13,
    textAlign: "center",
  },
  coordinates: {
    color: colors.dark[500],
    fontSize: 11,
  },
});
