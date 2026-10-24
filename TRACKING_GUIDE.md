# ConnectMyTask Task GPS Tracking

This guide explains how task tracking works in the current project, how to run it locally, and how to test it safely.

## What the map shows

- The task marker is the saved task-site coordinate (`siteLatitude`, `siteLongitude`). It is not the requester's live device location.
- The provider marker is the provider's latest GPS point saved for that task.
- The requester and assigned provider can see the map inside the selected task in **My Assigned Tasks** / task progress.
- The requester can view the map on web or mobile. Only the assigned provider can send GPS, and only from the mobile app while it is open.
- The assigned provider opts in with **Start sharing journey**. The mobile app sends a GPS sample every five seconds while the tracking screen is open and the app is in the foreground.
- The requester-set task-site marker is always shown separately from the provider's latest shared location.
- The provider can share the journey before reaching the task site. A 100 m radius check runs only when the provider presses **I've arrived**.
- Maps use Leaflet/OpenStreetMap on web and a Leaflet map inside a mobile WebView. Internet access is needed to load map tiles.

## Requirements before testing

1. Configure a working PostgreSQL database in the root `.env`.
2. Make sure both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` contain real database URLs. Do not leave template values such as `YOUR_NEON_HOST`.
3. Apply the Prisma schema to a development/test database and generate the client:

   ```powershell
   npx prisma generate
   npx prisma db push
   ```

4. Arrival verification requires a task with a trusted site address and coordinates. Location sharing and arrival verification do not require funded escrow.
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
3. As the requester, assign that provider's bid. Escrow payment is not required for journey sharing or arrival verification.
4. On the provider's phone, open **My Assigned Tasks**, select the assigned task and tap **Start sharing journey**. Allow foreground location access.
5. Confirm the provider marker updates while travelling, including when it is more than 100 metres from the task site.
6. When the provider reaches the task site, tap **I've arrived**. The GPS sample must be accurate to 100 metres or better and within 100 metres of the saved task site. Arrival verification expires after one hour.
7. Open that same task as the requester on web or mobile. The map shows the requester-set task pin and the provider's latest recorded point.
8. Leave the provider app and selected task screen open while testing. Sharing stops when the app moves out of the foreground, the screen is left, or the provider stops sharing.

The map can still show the saved task marker before the provider has shared GPS. It reports that it is waiting for a provider location until the first point is recorded.

## Tracking API routes

All routes are under `/api/tracking` and require authentication.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/tasks/:taskId/site-location` | Get saved requester-set coordinates for a task participant |
| `GET` | `/tasks/:taskId/latest` | Get the newest location for an authorized task participant |
| `GET` | `/tasks/:taskId/history` | Get recent location history for an authorized task participant |
| `GET` | `/tasks/:taskId/verification` | Read task location-verification status |
| `POST` | `/tasks/:taskId/verify` | Verify the assigned provider's current GPS point against the task site |
| `POST` | `/update` | Save a new provider location for an active task |

The backend checks participant access on reads, including the precise site-location route, and derives provider identity from the authenticated user on writes. Verification/update requests validate coordinates, GPS accuracy and timestamp. Journey updates require the task to be active; only the explicit arrival-verification request checks the 100 m radius. Location sharing and arrival verification do not require escrow funding. Do not bypass these checks by writing directly to the database.

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

- Arrival confirmation is separate from journey sharing and requires an active task with valid site coordinates.
- The provider must be within 100 metres of the saved task coordinates and the GPS sample must be accurate to 100 metres or better.
- If the pin is incorrect, update the task-site address/location before relying on arrival verification.

### The requester sees the map but no provider marker

The provider must start sharing from the mobile app. The provider app must remain in the foreground for updates. Check the API URL on a physical phone; `localhost` on the phone does not refer to the development computer.

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
