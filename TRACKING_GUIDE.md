# ConnectMyTask Task GPS Tracking

This guide explains how task tracking works in the current project, how to run it locally, and how to test it safely.

## What the map shows

- The task marker is the saved task-site coordinate (`siteLatitude`, `siteLongitude`). It is not the requester's live device location.
- The provider marker is the provider's latest GPS point held temporarily in API memory; individual journey points are not written to the tracking-history table.
- Tracking and the requester's precise task address are available to task participants only after requester escrow funding is confirmed (`HELD`). The public task district remains visible before funding.
- The requester and assigned provider can see the map inside the selected task in **My Assigned Tasks** / task progress.
- The requester can view the map on web or mobile. Only the assigned provider can send GPS, and only from the mobile app while it is open.
- The assigned provider opts in with **Start sharing journey**. The mobile app sends a GPS sample every five seconds while the tracking screen is open and the app is in the foreground.
- The requester-set task-site marker is always shown separately from the provider's latest shared location.
- After escrow is funded, the provider can share the journey and verify their location from the mobile app. Verification accepts a fresh GPS sample within 1 km of the task site.
- Maps use Leaflet/OpenStreetMap on web and a Leaflet map inside a mobile WebView. Internet access is needed to load map tiles.

## Requirements before testing

1. Configure a working PostgreSQL database in the root `.env`.
2. Make sure both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` contain real database URLs. Do not leave template values such as `YOUR_NEON_HOST`.
3. Apply the Prisma schema to a development/test database and generate the client:

   ```powershell
   npx prisma generate
   npx prisma db push
   ```

4. Tracking, requester address and verification require an assigned provider, a task with a trusted site address and coordinates, and confirmed escrow funding. Tracking and GPS collection are blocked before funding.
5. To test from a physical phone, the phone and computer must be able to reach each other and the API URL must use the computer's LAN IP, not `localhost`.

> `db push` changes the selected database schema. Use a development/test database unless you have confirmed that updating the target database is safe.

## Start the application

Run each service in its own PowerShell terminal.

### Terminal 1: API

From the repository root:

```powershell
npm install
npx prisma generate
npm run dev
```

The API listens on `http://localhost:4000`. Check its health endpoint:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

### Terminal 2: Web app

```powershell
cd frontend-web
npm install
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`.

### Terminal 3: Mobile app

```powershell
cd frontend-mobile
npm install
npm run android
```

For a real Android phone, create `frontend-mobile/.env` and replace the example IP with the computer's current LAN IPv4 address:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api
```

Then start Expo in LAN mode:

```powershell
npm start -- --lan
```

Scan the QR code in Expo Go. Allow Node/Expo through Windows Firewall on a private network if prompted. For an Android emulator, `npm run android` can use the app's built-in emulator host resolution.

`npm run ipad` starts Expo using a tunnel, but the API still needs to be reachable from the phone. Set `EXPO_PUBLIC_API_URL` to the computer's LAN IP when using a local API. An iOS Simulator requires macOS and Xcode.

## Test the requester/provider flow

1. Sign in as a requester and create a task. Enter a valid task address and confirm its map coordinates.
2. Sign in as a provider and submit a bid for that task.
3. As the requester, assign that provider's bid and fund escrow. The tracking map and precise requester task address appear for task participants after payment confirmation.
4. On the provider's phone, open **My Assigned Tasks**, select the assigned task and tap **Start sharing journey**. Allow foreground location access.
5. Confirm the provider marker updates while travelling, including when it is more than 1 km from the task site.
6. After escrow is funded, tap **Verify location**. The GPS sample must be accurate to 100 metres or better, no more than two minutes old, and within 1 km of the saved task site. Verification expires after one hour; provider progress is blocked in the web and mobile apps after expiry until the provider verifies again.
7. Open that same task as the requester on web or mobile. The map shows the requester-set task pin and the provider's latest live point.
8. Leave the provider app and selected task screen open while testing. Sharing stops when the app moves out of the foreground, the screen is left, or the provider stops sharing.

The map can still show the saved task marker before the provider has shared GPS. It reports that it is waiting for a provider location until the first point is shared. The API holds only the latest provider point in memory for up to two minutes; it is lost when the API restarts or the point expires. The history endpoint returns an empty list and does not read location history from the database.

## Tracking API routes

All routes are under `/api/tracking` and require authentication.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/tasks/:taskId/site-location` | Get saved requester-set coordinates for a task participant |
| `GET` | `/tasks/:taskId/latest` | Get the latest in-memory location for an authorized task participant (expires after two minutes) |
| `GET` | `/tasks/:taskId/history` | Return an empty list; provider journey history is not stored |
| `GET` | `/tasks/:taskId/verification` | Read task location-verification status |
| `POST` | `/tasks/:taskId/verify` | Verify the assigned provider's current GPS point against the task site |
| `POST` | `/update` | Replace the task's latest in-memory provider location |

The backend checks participant access and requires `HELD` escrow to read task-site coordinates/address or provider tracking. The precise site address is returned only by the participant-only site-location endpoint, never in public task details. It derives provider identity from the authenticated user on writes. Verification/update requests validate coordinates, GPS accuracy and timestamp. Journey updates require the task to be active; they replace a single in-memory latest point and are not inserted into `TRACKING_LOGS`. The latest point is discarded after two minutes or when the API restarts, so it is not shared between multiple API instances. The history endpoint returns `[]`. Location-verification evidence remains persisted separately to support the funded-escrow and verification-expiry gates. Do not bypass these checks by writing directly to the database.

## Troubleshooting

### The API or Prisma reports `YOUR_NEON_HOST` / `P1001`

Replace the template values in the root `.env` with real database URLs. Use the pooled URL for `DATABASE_URL` and the direct URL for `DATABASE_URL_UNPOOLED`. Keep credentials private.

### The map says coordinates are unavailable

The task needs valid saved latitude and longitude. A textual address alone is not enough for these map components to place the task marker or for backend GPS verification.

### The provider cannot start sharing

Check that:

- The signed-in account is the provider assigned to this task.
- The task is active (`ASSIGNED`, `IN_PROGRESS` or `PENDING_CONFIRMATION`).
- Foreground location permission is granted and device location services are enabled.
- The phone has internet access and can reach the backend.
- The assigned task is selected in **My Assigned Tasks**.

### The provider cannot confirm arrival

- Location verification is separate from journey sharing, but both require funded escrow; they also require an active task and valid site coordinates.
- The provider must be within 1 km of the saved task coordinates and the GPS sample must be accurate to 100 metres or better and no more than two minutes old.
- If the pin is incorrect, update the task-site address/location before relying on location verification.

### The requester sees the map but no provider marker

The provider must start sharing from the mobile app. The provider app must remain in the foreground for updates. The API must be the same running instance used by the requester because live points are held in process memory. Check the API URL on a physical phone; `localhost` on the phone does not refer to the development computer.

### The base map or tiles do not load

The Leaflet map tiles are fetched from OpenStreetMap over the internet. Check connectivity, firewall/proxy settings and that the device can access OpenStreetMap.

### Tracking tests

The backend tracking service tests use mocked database operations and do not require a live database. From the repository root:

```powershell
node --test src/modules/tracking/tracking.test.js
```

## Privacy and scope

- Requesters do not need to grant GPS permission. Their map marker represents the task-site coordinates.
- Provider GPS is shared only by the assigned provider after opting in, and this implementation uses foreground location rather than background tracking.
- Task tracking endpoints are authenticated and restrict access to task participants (with the backend's existing admin exception for relevant reads).
- Map refresh is HTTP polling, not a live Socket.IO location stream.
