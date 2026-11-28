import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api } from "@/services/api";
import { Task, User } from "@/types";
import { colors, radius } from "@/theme/tokens";
import { useMapTouchLock } from "@/components/ScrollLock";
import { buildLocationEvidence, buildVerificationEvidence } from "@/utils/locationVerification";
import {
  LOCATION_SAMPLE_INTERVAL_MS,
  shouldUploadLocation,
  type LastUploadedLocation,
} from "@/utils/locationSharing";
import { isProvider } from "@/utils/taskUtils";

type Point = { latitude: number; longitude: number };
type RoadRoute = {
  coordinates: Point[];
  distanceKm: number;
  durationMinutes: number;
};
const MAX_LOCATION_SHARING_ACCURACY_METERS = 100;
// Arrival check accepts GPS accuracy up to 100 m (MERGE decision; main uses 20 m).
const MAX_VERIFICATION_ACCURACY_METERS = 100;
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

function getTaskPoint(task: Pick<Task, "siteLatitude" | "siteLongitude">): Point | null {
  if (task.siteLatitude == null || task.siteLongitude == null) return null;
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
let taskMarker=null,providerMarker=null,routeLine=null,youMarker=null,youAccuracy=null;
const shown={};
window.updateTaskTracking=function(data){
const task=data.taskLocation&&[data.taskLocation.latitude,data.taskLocation.longitude];
const provider=data.providerLocation&&[data.providerLocation.latitude,data.providerLocation.longitude];
const you=data.myLocation&&[data.myLocation.latitude,data.myLocation.longitude];
if(task){if(taskMarker)taskMarker.setLatLng(task);else taskMarker=L.marker(task,{icon:taskIcon}).addTo(map).bindPopup('Requester-set task location');}
if(provider){if(providerMarker)providerMarker.setLatLng(provider);else providerMarker=L.marker(provider,{icon:providerIcon}).addTo(map).bindPopup('Provider location (last shared)');}
if(you){
const acc=Math.max(Number(data.myLocation.accuracy)||0,5);
if(youMarker){youMarker.setLatLng(you);youAccuracy.setLatLng(you).setRadius(acc);}
else{youAccuracy=L.circle(you,{radius:acc,color:'#9333ea',weight:1,fillColor:'#a855f7',fillOpacity:0.15,interactive:false}).addTo(map);
youMarker=L.circleMarker(you,{radius:8,color:'#ffffff',weight:3,fillColor:'#9333ea',fillOpacity:1}).addTo(map).bindPopup('You are here');}
}
if(routeLine){map.removeLayer(routeLine);routeLine=null;}
const route=Array.isArray(data.routeCoordinates)?data.routeCoordinates.map(point=>[point.latitude,point.longitude]):[];
if(route.length>1)routeLine=L.polyline(route,{color:'#2563eb',weight:5,opacity:0.85}).addTo(map);
// Re-frame only when a marker or the road route first appears, so live updates never undo the user's zoom or panning.
const fresh=[['task',task],['provider',provider],['you',you],['route',route.length>1?route:null]].filter(([k,p])=>p&&!shown[k]).map(([k])=>(shown[k]=true)).length>0;
if(fresh){const points=route.length>1?route:[task,you||provider].filter(Boolean);
if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[40,40],maxZoom:17});else if(points.length===1)map.setView(points[0],16);}
};
window.ReactNativeWebView.postMessage('map-ready');
}</script></body></html>`;
}

export function TaskTrackingMap({ task, user }: TaskTrackingMapProps): React.ReactElement {
  const taskId = task.id;
  const taskSiteLatitude = task.siteLatitude;
  const taskSiteLongitude = task.siteLongitude;
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState("");
  const [taskPoint, setTaskPoint] = useState<Point | null>(() => getTaskPoint(task));
  const [siteAddress, setSiteAddress] = useState("");
  // Set when the task was posted at a nearby address: the requester's real home address.
  const [requesterAddress, setRequesterAddress] = useState("");
  // Private address details from the requester (unit / floor, or the exact address).
  const [addressDetail, setAddressDetail] = useState("");
  const [isNearbySite, setIsNearbySite] = useState(false);
  const [siteLocationError, setSiteLocationError] = useState("");
  const assignedProvider = Boolean(
    isProvider(user) && String(task.assignedProviderId) === String(user?.id)
  );
  const escrowFunded = task.escrowStatus === "HELD";
  const taskIsActive = ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"].includes(String(task.status));
  const canVerifyArrival = Platform.OS !== "web" && escrowFunded && taskIsActive
    && taskPoint != null;
  const verificationBlockMessage = Platform.OS === "web"
    ? "Location verification is only available in the mobile app."
    : !escrowFunded
      ? "Tracking and location verification unlock after the requester funds escrow."
      : !taskIsActive
        ? "Location verification is only available while the task is active."
        : !taskPoint
          ? "Location verification needs a saved task map pin. Ask the requester to update the task location."
          : null;
  const [latest, setLatest] = useState<TrackingLog | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isVerifyingArrival, setIsVerifyingArrival] = useState(false);
  const [isArrived, setIsArrived] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sharingError, setSharingError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  // The assigned provider's own live device position ("you are here"), separate
  // from the last location they shared with the requester.
  const [myLocation, setMyLocation] = useState<(Point & { accuracy: number | null }) | null>(null);
  const [myLocationError, setMyLocationError] = useState("");
  const mapRef = useRef<WebView<object> | null>(null);
  const mapTouchLock = useMapTouchLock();
  const sharingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sharingSessionRef = useRef(0);
  const sendInFlightRef = useRef(false);
  const routeRequestIdRef = useRef(0);
  const lastUploadedLocationRef = useRef<LastUploadedLocation | null>(null);
  const mountedRef = useRef(true);
  const providerPoint = useMemo(() => getProviderPoint(latest), [latest]);
  // The map page is built once; later positions are pushed with injectJavaScript,
  // so changing the centre must not rebuild the HTML (that reloads the WebView).
  const initialCenterRef = useRef(taskPoint || providerPoint || { latitude: 10.7769, longitude: 106.7009 });
  const html = useMemo(() => createMapHtml(initialCenterRef.current), []);
  const routeOriginLatitude = providerPoint?.latitude;
  const routeOriginLongitude = providerPoint?.longitude;
  const routeDestinationLatitude = taskPoint?.latitude;
  const routeDestinationLongitude = taskPoint?.longitude;

  useEffect(() => {
    if (routeOriginLatitude == null || routeOriginLongitude == null
      || routeDestinationLatitude == null || routeDestinationLongitude == null) {
      setRoadRoute(null);
      setRouteError("");
      return;
    }

    const requestId = ++routeRequestIdRef.current;
    api.tracking.route(taskId)
      .then((response) => {
        if (!mountedRef.current || requestId !== routeRequestIdRef.current) return;
        const route = response.data as RoadRoute | null;
        if (!route || !Array.isArray(route.coordinates) || route.coordinates.length < 2) {
          setRoadRoute(null);
          setRouteError("");
          return;
        }
        setRoadRoute(route);
        setRouteError("");
      })
      .catch((error: any) => {
        if (!mountedRef.current || requestId !== routeRequestIdRef.current) return;
        setRoadRoute(null);
        setRouteError(getTrackingErrorMessage(error, "Unable to update the road route."));
      });

    return () => {
      if (routeRequestIdRef.current === requestId) routeRequestIdRef.current += 1;
    };
  }, [
    routeDestinationLatitude,
    routeDestinationLongitude,
    routeOriginLatitude,
    routeOriginLongitude,
    taskId,
  ]);

  // Parent screens refetch the task (focus, polling), which gives a new `task`
  // object with the same data. Only reload the site when the site itself changes,
  // and keep showing the current address while reloading so it does not flicker.
  const siteKey = [task.id, task.escrowStatus, task.siteLatitude, task.siteLongitude, task.siteAddress].join("|");
  useEffect(() => {
    let mounted = true;
    const fallbackPoint = getTaskPoint(task);
    if (fallbackPoint) setTaskPoint(fallbackPoint);
    api.tracking.taskSiteLocation(taskId)
      .then((response) => {
        if (!mounted) return;
        const point = getTaskPoint({
          siteLatitude: response.data?.siteLatitude !== undefined
            ? response.data.siteLatitude
            : taskSiteLatitude,
          siteLongitude: response.data?.siteLongitude !== undefined
            ? response.data.siteLongitude
            : taskSiteLongitude,
        });
        setTaskPoint(point);
        setSiteAddress(typeof response.data?.siteAddress === "string" ? response.data.siteAddress : "");
        setRequesterAddress(typeof response.data?.requesterAddress === "string" ? response.data.requesterAddress : "");
        setAddressDetail(typeof response.data?.addressDetail === "string" ? response.data.addressDetail : "");
        setIsNearbySite(Boolean(response.data?.isApproximateLocation));
        setSiteLocationError(point
          ? ""
          : "This task has no saved requester pin. Update the task location and confirm its map pin.");
      })
      .catch((error: any) => {
        if (!mounted) return;
        setSiteAddress("");
        setRequesterAddress("");
        setAddressDetail("");
        setSiteLocationError(
          error?.response?.data?.message || error?.message || "Unable to load requester task location."
        );
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

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
    }
  }, [task.id]);

  const stopSharing = useCallback(() => {
    sharingSessionRef.current += 1;
    if (sharingIntervalRef.current) clearInterval(sharingIntervalRef.current);
    sharingIntervalRef.current = null;
    lastUploadedLocationRef.current = null;
    setIsSharing(false);
  }, []);

  useEffect(() => {
    if (!assignedProvider || !escrowFunded || !taskIsActive) {
      stopSharing();
    }
  }, [assignedProvider, escrowFunded, stopSharing, taskIsActive]);

  const sendLocation = useCallback(async (
    coords: Location.LocationObjectCoords,
    timestamp: number,
    sharingSession: number
  ): Promise<boolean> => {
    if (sharingSession !== sharingSessionRef.current) return false;
    if (sendInFlightRef.current) return false;
    if (coords.accuracy == null || !Number.isFinite(coords.accuracy)
      || coords.accuracy <= 0 || coords.accuracy > MAX_LOCATION_SHARING_ACCURACY_METERS) {
      setSharingError(`GPS accuracy must be ${MAX_LOCATION_SHARING_ACCURACY_METERS} metres or better to share your location.`);
      return false;
    }
    const uploadStartedAt = Date.now();
    if (!shouldUploadLocation(coords, lastUploadedLocationRef.current, uploadStartedAt)) return true;
    sendInFlightRef.current = true;
    try {
      const evidence = buildLocationEvidence(coords, timestamp);
      const response = await api.tracking.update({
        taskId: Number(task.id),
        ...evidence,
        source: "GPS",
      });
      if (!mountedRef.current || sharingSession !== sharingSessionRef.current) return false;
      lastUploadedLocationRef.current = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        uploadedAt: uploadStartedAt,
      };
      setLatest(response.data);
      setSharingError("");
      return true;
    } catch (error: any) {
      if (mountedRef.current && sharingSession === sharingSessionRef.current) {
        if (error?.response?.status === 409) stopSharing();
        setSharingError(getTrackingErrorMessage(error, "Unable to share your location."));
      }
      return false;
    } finally {
      sendInFlightRef.current = false;
    }
  }, [stopSharing, task.id]);

  const verifyTaskLocation = async (): Promise<void> => {
    if (isVerifyingArrival) return;
    if (!canVerifyArrival) {
      setSharingError(verificationBlockMessage || "Location verification is unavailable for this task.");
      return;
    }
    setIsVerifyingArrival(true);
    setSharingError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow foreground location access to verify your location.");
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (point.coords.accuracy == null || !Number.isFinite(point.coords.accuracy)
        || point.coords.accuracy <= 0 || point.coords.accuracy > MAX_VERIFICATION_ACCURACY_METERS) {
        throw new Error(`GPS accuracy must be ${MAX_VERIFICATION_ACCURACY_METERS} metres or better to verify your location.`);
      }
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
      Alert.alert("Location verified", "You are at the task site. You can start work now.");
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
    if (!escrowFunded) {
      return;
    }
    if (!taskIsActive) {
      setSharingError("This task is not currently active.");
      return;
    }

    setIsStarting(true);
    setSharingError("");
    const sharingSession = ++sharingSessionRef.current;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location access to share your live position.");
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const firstLocationSent = await sendLocation(point.coords, point.timestamp, sharingSession);
      if (!firstLocationSent) return;
      if (!mountedRef.current) return;
      sharingIntervalRef.current = setInterval(() => {
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((position) => sendLocation(position.coords, position.timestamp, sharingSession))
          .catch((error: any) => {
            if (mountedRef.current) {
              setSharingError(getTrackingErrorMessage(error, "Unable to get your current location."));
            }
          });
      }, LOCATION_SAMPLE_INTERVAL_MS);
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
    const timer = setInterval(() => void refreshLocation(), 10000);
    return () => clearInterval(timer);
  }, [refreshLocation]);

  useEffect(() => {
    void refreshArrival();
    const timer = setInterval(() => void refreshArrival(), 30000);
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
    if (Platform.OS === "web" || !assignedProvider) return undefined;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        const permission = current.status === "granted" ? current : await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== "granted") {
          setMyLocationError("Allow location access to see where you are on the map.");
          return;
        }
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 3 },
          (position) => {
            const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
            if (!mountedRef.current || !isValidPoint(point)) return;
            setMyLocation({ ...point, accuracy: position.coords.accuracy ?? null });
            setMyLocationError("");
          }
        );
        if (cancelled) watcher.remove();
        else subscription = watcher;
      } catch (error: any) {
        if (!cancelled) setMyLocationError(error?.message || "Unable to show your current location.");
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [assignedProvider]);

  useEffect(() => {
    if (!mapReady) return;
    const data = JSON.stringify({
      taskLocation: taskPoint,
      providerLocation: latest && providerPoint ? providerPoint : null,
      myLocation,
      routeCoordinates: roadRoute?.coordinates || null,
    });
    mapRef.current?.injectJavaScript(`window.updateTaskTracking(${data}); true;`);
  }, [latest, mapReady, myLocation, providerPoint, roadRoute, taskPoint]);

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
          ? "Share your journey with the requester. When you arrive at the task site, verify your location to start work."
          : "Follow the provider's route to the task location."}
      </Text>
      {assignedProvider && addressDetail ? (
        <View style={styles.homeBox}>
          <Text style={styles.homeTitle}>{isNearbySite ? "Exact address (job location)" : "Address details"}: {addressDetail}</Text>
          {isNearbySite ? <Text style={styles.homeNote}>The map pin is a nearby address within 100 m; location check uses that pin.</Text> : null}
        </View>
      ) : null}
      {assignedProvider && requesterAddress ? (
        <View style={styles.homeBox}>
          <Text style={styles.homeTitle}>Requester's home (job location): {requesterAddress}</Text>
          <Text style={styles.homeNote}>The map pin is a nearby address within 100 m; location check uses that pin.</Text>
        </View>
      ) : null}
      {assignedProvider && siteAddress ? (
        <View style={styles.addressBox}>
          <Text style={styles.addressLabel}>{requesterAddress || isNearbySite ? "Nearby address on the map:" : "Requester task address:"}</Text>
          <Text style={styles.addressText}>{siteAddress}</Text>
        </View>
      ) : null}
      {/* While touched, the page stops scrolling so the drag pans the map. */}
      <View style={styles.mapFrame} {...mapTouchLock}>
        <WebView<object>
          nestedScrollEnabled
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
        <Text style={styles.legendText}>Green: {assignedProvider ? "task location" : "your task location"}</Text>
        <Text style={styles.legendText}>Blue: {assignedProvider ? "your last shared location" : "provider"}</Text>
        {assignedProvider ? <Text style={[styles.legendText, styles.legendYou]}>Purple: you (live)</Text> : null}
      </View>
      {assignedProvider && myLocationError ? <Text style={styles.helperText}>{myLocationError}</Text> : null}
      {roadRoute ? (
        <Text style={styles.helperText}>
          Road route: {roadRoute.distanceKm.toFixed(1)} km · about {Math.round(roadRoute.durationMinutes)} min
        </Text>
      ) : null}
      {!taskPoint ? (
        <Text style={styles.helperText}>Precise task coordinates are not available.</Text>
      ) : null}
      {routeError ? <Text accessibilityRole="alert" style={styles.errorText}>{routeError}</Text> : null}
      {siteLocationError ? <Text accessibilityRole="alert" style={styles.errorText}>{siteLocationError}</Text> : null}
      {latest?.timestamp ? (
        <Text style={styles.helperText}>Last update: {new Date(latest.timestamp).toLocaleString()}</Text>
      ) : null}
      {assignedProvider ? (
        <Text style={styles.helperText}>
          {isArrived ? "Location verified: you are at the task site." : "Task location has not been verified yet."}
        </Text>
      ) : null}
      {assignedProvider && !escrowFunded ? (
        <Text style={styles.helperText}>{verificationBlockMessage}</Text>
      ) : null}
      {assignedProvider && escrowFunded && !canVerifyArrival ? (
        <Text style={styles.helperText}>{verificationBlockMessage}</Text>
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
            title={isVerifyingArrival ? "Checking location..." : isArrived ? "Recheck location" : "Verify location"}
            variant="outline"
            loading={isVerifyingArrival}
            disabled={isStarting || isVerifyingArrival || !canVerifyArrival}
            onPress={() => void verifyTaskLocation()}
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
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
  legendYou: {
    color: "#9333ea",
  },
  legendText: {
    color: colors.dark[700],
    fontSize: 12,
    fontWeight: "600",
  },
  homeBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning[200],
    backgroundColor: colors.warning[50],
    gap: 4,
  },
  homeTitle: { color: colors.dark[900], fontSize: 13, fontWeight: "700", lineHeight: 18 },
  homeNote: { color: colors.dark[600], fontSize: 12, lineHeight: 17 },
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
  addressBox: {
    marginBottom: 12,
    gap: 2,
  },
  addressLabel: {
    color: colors.dark[600],
    fontSize: 14,
    fontWeight: "700",
  },
  addressText: {
    color: colors.dark[900],
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
});
