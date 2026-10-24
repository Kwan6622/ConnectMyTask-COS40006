import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api } from "@/services/api";
import { Task, User } from "@/types";
import { colors, radius } from "@/theme/tokens";
import { buildLocationEvidence, buildVerificationEvidence } from "@/utils/locationVerification";
import { isProvider } from "@/utils/taskUtils";

type Point = { latitude: number; longitude: number };
type TrackingLog = {
  id: string | number;
  taskId: string | number;
  providerId: string | number;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
};

type TaskTrackingMapProps = {
  task: Task;
  user: User | null;
};

function isValidPoint(point: Point | null): point is Point {
  return Boolean(point
    && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180);
}

function getTaskPoint(task: Task): Point | null {
  const latitude = Number(task.siteLatitude);
  const longitude = Number(task.siteLongitude);
  const point = { latitude, longitude };
  return isValidPoint(point) ? point : null;
}

function getProviderPoint(location: TrackingLog | null): Point | null {
  if (!location) return null;
  const point = { latitude: Number(location.lat), longitude: Number(location.lng) };
  return isValidPoint(point) ? point : null;
}

function getTrackingErrorMessage(error: any, fallback: string): string {
  const responseData = error?.response?.data;
  if (typeof responseData?.message === "string") return responseData.message;
  if (Array.isArray(responseData?.details)) {
    const details = responseData.details
      .map((detail: { path?: unknown; message?: unknown }) => {
        const path = Array.isArray(detail.path) ? detail.path.join(".") : "";
        return [path, detail.message].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (details.length > 0) return details.join("; ");
  }
  return error?.message || fallback;
}

function createMapHtml(initialCenter: Point): string {
  const center = JSON.stringify([initialCenter.latitude, initialCenter.longitude]);
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{height:100%;width:100%;margin:0;background:#e2e8f0}
.marker{display:flex;width:30px;height:30px;align-items:center;justify-content:center;border:3px solid white;border-radius:50%;color:white;font:700 13px sans-serif;box-shadow:0 1px 5px #334155}
.task-marker{background:#16a34a}.provider-marker{background:#2563eb}
</style>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="window.ReactNativeWebView.postMessage('map-error')"></script>
</head><body><div id="map"></div><script>
if(!window.L){window.ReactNativeWebView.postMessage('map-error')}else{
const map=L.map('map').setView(${center},14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const taskIcon=L.divIcon({className:'',html:'<div class="marker task-marker">T</div>',iconSize:[36,36],iconAnchor:[18,18]});
const providerIcon=L.divIcon({className:'',html:'<div class="marker provider-marker">P</div>',iconSize:[36,36],iconAnchor:[18,18]});
let taskMarker=null,providerMarker=null;
window.updateTaskTracking=function(data){
const task=data.taskLocation&&[data.taskLocation.latitude,data.taskLocation.longitude];
const provider=data.providerLocation&&[data.providerLocation.latitude,data.providerLocation.longitude];
if(task){if(taskMarker)taskMarker.setLatLng(task);else taskMarker=L.marker(task,{icon:taskIcon}).addTo(map).bindPopup('Requester-set task location');}
if(provider){if(providerMarker)providerMarker.setLatLng(provider);else providerMarker=L.marker(provider,{icon:providerIcon}).addTo(map).bindPopup('Provider location');}
const points=[task,provider].filter(Boolean);
if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[32,32],maxZoom:15});else if(points.length===1)map.setView(points[0],15);
};
window.ReactNativeWebView.postMessage('map-ready');
}</script></body></html>`;
}

export function TaskTrackingMap({ task, user }: TaskTrackingMapProps): React.ReactElement {
  const [taskPoint, setTaskPoint] = useState<Point | null>(() => getTaskPoint(task));
  const [siteLocationError, setSiteLocationError] = useState("");
  const assignedProvider = Boolean(
    isProvider(user) && String(task.assignedProviderId) === String(user?.id)
  );
  const [latest, setLatest] = useState<TrackingLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isVerifyingArrival, setIsVerifyingArrival] = useState(false);
  const [isArrived, setIsArrived] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sharingError, setSharingError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const mapRef = useRef<WebView<object> | null>(null);
  const sharingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const providerPoint = useMemo(() => getProviderPoint(latest), [latest]);
  const initialCenter = taskPoint || providerPoint || { latitude: 10.7769, longitude: 106.7009 };
  const html = useMemo(
    () => createMapHtml(initialCenter),
    [initialCenter.latitude, initialCenter.longitude]
  );

  useEffect(() => {
    let mounted = true;
    api.tracking.taskSiteLocation(task.id)
      .then((response) => {
        if (!mounted) return;
        const point = getTaskPoint({ ...task, ...response.data });
        setTaskPoint(point);
        setSiteLocationError(point
          ? ""
          : "This task has no saved requester pin. Update the task location and confirm its map pin.");
      })
      .catch((error: any) => {
        if (!mounted) return;
        setSiteLocationError(
          error?.response?.data?.message || error?.message || "Unable to load requester task location."
        );
      });
    return () => {
      mounted = false;
    };
  }, [task]);

  const refreshLocation = useCallback(async () => {
    try {
      const response = await api.tracking.latest(task.id);
      if (!mountedRef.current) return;
      setLatest(response.data || null);
      setLoadError("");
    } catch (error: any) {
      if (mountedRef.current) {
        setLoadError(error?.response?.data?.message || error?.message || "Unable to load provider location.");
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [task.id]);

  const stopSharing = useCallback(() => {
    if (sharingIntervalRef.current) clearInterval(sharingIntervalRef.current);
    sharingIntervalRef.current = null;
    setIsSharing(false);
  }, []);

  const sendLocation = useCallback(async (coords: Location.LocationObjectCoords, timestamp: number): Promise<boolean> => {
    if (sendInFlightRef.current) return false;
    if (coords.accuracy == null || !Number.isFinite(coords.accuracy) || coords.accuracy <= 0) {
      setSharingError("GPS did not provide an accurate location sample.");
      return false;
    }
    sendInFlightRef.current = true;
    try {
      const evidence = buildLocationEvidence(coords, timestamp);
      const response = await api.tracking.update({ taskId: Number(task.id), ...evidence });
      if (!mountedRef.current) return false;
      setLatest(response.data);
      setSharingError("");
      return true;
    } catch (error: any) {
      if (mountedRef.current) {
        if (error?.response?.status === 409) stopSharing();
        setSharingError(getTrackingErrorMessage(error, "Unable to share your location."));
      }
      return false;
    } finally {
      sendInFlightRef.current = false;
    }
  }, [stopSharing, task.id]);

  const verifyArrival = async (): Promise<void> => {
    if (Platform.OS === "web" || isVerifyingArrival) return;
    setIsVerifyingArrival(true);
    setSharingError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location access to confirm your arrival.");
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const response = await api.tracking.verify(
        task.id,
        buildVerificationEvidence(point.coords, point.timestamp)
      );
      if (!mountedRef.current) return;
      setIsArrived(true);
      setLatest({
        id: `gps-${point.timestamp}`,
        taskId: task.id,
        providerId: user?.id ?? task.assignedProviderId ?? "",
        lat: point.coords.latitude,
        lng: point.coords.longitude,
        accuracy: point.coords.accuracy,
        timestamp: new Date(point.timestamp).toISOString(),
      });
      setSharingError("");
      Alert.alert("Arrival confirmed", `Your location is ${response.data.distanceMeters} m from the task site.`);
    } catch (error: any) {
      if (mountedRef.current) {
        setSharingError(getTrackingErrorMessage(error, "Unable to confirm arrival."));
      }
    } finally {
      if (mountedRef.current) setIsVerifyingArrival(false);
    }
  };

  const refreshArrival = useCallback(async (): Promise<void> => {
    try {
      const response = await api.tracking.getVerification(task.id);
      if (mountedRef.current) setIsArrived(Boolean(response.data?.isValid));
    } catch (error: any) {
      if (mountedRef.current) {
        setLoadError(getTrackingErrorMessage(error, "Unable to check arrival status."));
      }
    }
  }, [task.id]);

  const startSharing = async (): Promise<void> => {
    if (Platform.OS === "web") {
      setSharingError("Provider location sharing is available only in the mobile app.");
      return;
    }
    if (!["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"].includes(String(task.status))) {
      setSharingError("This task is not currently active.");
      return;
    }

    setIsStarting(true);
    setSharingError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location access to share your live position.");
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const firstLocationSent = await sendLocation(point.coords, point.timestamp);
      if (!firstLocationSent) return;
      if (!mountedRef.current) return;
      sharingIntervalRef.current = setInterval(() => {
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((position) => sendLocation(position.coords, position.timestamp))
          .catch((error: any) => {
            if (mountedRef.current) {
              setSharingError(getTrackingErrorMessage(error, "Unable to get your current location."));
            }
          });
      }, 5000);
      setIsSharing(true);
    } catch (error: any) {
      if (mountedRef.current) {
        stopSharing();
        setSharingError(getTrackingErrorMessage(error, "Unable to start GPS tracking."));
      } else {
        if (sharingIntervalRef.current) clearInterval(sharingIntervalRef.current);
        sharingIntervalRef.current = null;
      }
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  };

  useEffect(() => {
    void refreshLocation();
    const timer = setInterval(() => void refreshLocation(), 5000);
    return () => clearInterval(timer);
  }, [refreshLocation]);

  useEffect(() => {
    void refreshArrival();
    const timer = setInterval(() => void refreshArrival(), 15000);
    return () => clearInterval(timer);
  }, [refreshArrival]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (sharingIntervalRef.current) clearInterval(sharingIntervalRef.current);
      sharingIntervalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && assignedProvider) stopSharing();
    });
    return () => subscription.remove();
  }, [assignedProvider, stopSharing]);

  useEffect(() => {
    if (!mapReady) return;
    const data = JSON.stringify({ taskLocation: taskPoint, providerLocation: providerPoint });
    mapRef.current?.injectJavaScript(`window.updateTaskTracking(${data}); true;`);
  }, [mapReady, providerPoint, taskPoint]);

  const handleMapMessage = (event: WebViewMessageEvent): void => {
    if (event.nativeEvent.data === "map-ready") {
      setMapReady(true);
      setMapError(false);
    } else if (event.nativeEvent.data === "map-error") {
      setMapError(true);
    }
  };

  return (
    <Card title="Task live tracking">
      <Text style={styles.description}>
        {assignedProvider
          ? "Share your journey with the requester. GPS updates every 5 seconds; confirm arrival within 100 m of the task site."
          : "Green marks the location set by the requester; blue shows the provider's latest shared location."}
      </Text>
      <View style={styles.mapFrame}>
        <WebView<object>
          ref={mapRef}
          source={{ html }}
          style={styles.map}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
          onMessage={handleMapMessage}
          onLoadStart={() => setMapReady(false)}
          onError={() => setMapError(true)}
        />
        {mapError ? (
          <View style={styles.mapOverlay}>
            <Text style={styles.errorText}>Map could not load. Check your internet connection.</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Green: requester-set task location</Text>
        <Text style={styles.legendText}>Blue: provider</Text>
      </View>
      {!taskPoint ? (
        <Text style={styles.helperText}>Precise task coordinates are not available.</Text>
      ) : null}
      {siteLocationError ? <Text accessibilityRole="alert" style={styles.errorText}>{siteLocationError}</Text> : null}
      {!latest && !isLoading ? (
        <Text style={styles.helperText}>No provider GPS update yet.</Text>
      ) : null}
      {latest?.timestamp ? (
        <Text style={styles.helperText}>Last update: {new Date(latest.timestamp).toLocaleString()}</Text>
      ) : null}
      {assignedProvider ? (
        <Text style={styles.helperText}>
          {isArrived ? "Arrival confirmed within 100 m of the task site." : "Arrival has not been confirmed yet."}
        </Text>
      ) : null}
      {loadError ? <Text accessibilityRole="alert" style={styles.errorText}>{loadError}</Text> : null}
      {sharingError ? <Text accessibilityRole="alert" style={styles.errorText}>{sharingError}</Text> : null}
      {assignedProvider ? (
        <View style={styles.actions}>
          <Button
            title={isStarting ? "Starting..." : isSharing ? "Stop sharing location" : "Start sharing journey"}
            variant={isSharing ? "outline" : "primary"}
            loading={isStarting}
            disabled={isStarting || isVerifyingArrival || Platform.OS === "web"}
            onPress={() => (isSharing ? stopSharing() : void startSharing())}
          />
          <Button
            title={isVerifyingArrival ? "Checking location..." : isArrived ? "Recheck arrival (100 m)" : "I've arrived (100 m)"}
            variant="outline"
            loading={isVerifyingArrival}
            disabled={isStarting || isVerifyingArrival || Platform.OS === "web"}
            onPress={() => void verifyArrival()}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  description: {
    color: colors.dark[600],
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  actions: {
    gap: 8,
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
  mapOverlay: {
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
  legend: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
  legendText: {
    color: colors.dark[700],
    fontSize: 12,
    fontWeight: "600",
  },
  helperText: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  errorText: {
    color: colors.danger[700],
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
});
