## ConnectMyTask Backend API

Node.js / Express backend for the **ConnectMyTask** capstone project. This service provides task management, bidding, reviews, AI-assisted recommendations, and provider GPS tracking.

## Run Full Project (Backend + Web + Optional Mobile)

### Quick Run Commands (Windows/macOS/Linux)

Use 2 terminals.

Terminal 1 (root): backend + Prisma

```bash
cd <project-root>
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Terminal 2 (`frontend-web`): web

```bash
cd <project-root>/frontend-web
npm install
npm run dev
```

URLs:

- Backend: `http://localhost:4000`
- Web: `http://localhost:5173`

Required env files:

- Root `.env`: `DATABASE_URL=...`, `PORT=4000`, `JWT_SECRET=...`
- `frontend-web/.env`: `VITE_API_URL=http://localhost:4000/api`, `VITE_WS_URL=ws://localhost:4000`

### Prerequisites

- Node.js `>=18`
- npm `>=9`
- A valid Postgres database URL (local Postgres or Neon)

### 1) Backend setup (root folder)

From project root:

```bash
npm install
```

Create `.env` from `.env.example`:

- macOS/Linux:
```bash
cp .env.example .env
```
- Windows PowerShell:
```powershell
Copy-Item .env.example .env
```
- Windows CMD:
```bat
copy .env.example .env
```

Update `.env`:

- `DATABASE_URL` (your Neon/local Postgres URL)
- `PORT=4000`
- `JWT_SECRET` (any secure random string)

Then prepare Prisma:

```bash
npx prisma generate
npx prisma db push
```

Run backend:

```bash
npm run dev
```

Backend should run at `http://localhost:4000`.

### 2) Web setup (`frontend-web`)

Open a second terminal:

```bash
cd frontend-web
npm install
```

Create/update `frontend-web/.env`:

```env
VITE_API_URL=http://localhost:4000/api
VITE_WS_URL=ws://localhost:4000
```

Run web:

```bash
npm run dev
```

Web should run at `http://localhost:5173`.

### NPM steps required before running web

From project root (backend + Prisma):

```bash
npm install
npx prisma generate
npx prisma db push
```

Then from web folder:

```bash
cd frontend-web
npm install
npm run dev
```

If you skip root install/Prisma steps, login/tasks/payment APIs can fail even when web UI opens.

### Stripe sandbox test cards (Payment)

Use these in Stripe Checkout test mode:

- Success: `4242 4242 4242 4242`
- Requires 3DS authentication: `4000 0025 0000 3155`
- Declined (insufficient funds): `4000 0000 0000 9995`

### 3) Optional mobile setup (`frontend-mobile`)

Note: iOS Simulator requires a MacBook/macOS with Xcode installed.
If you are on Windows/Linux, use Android emulator or iPad/iPhone real device via Expo Go.

Open a third terminal:

```bash
cd frontend-mobile
npm install
```

Create/update `frontend-mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:4000/api
```

For a physical iPhone/iPad or Android device, replace `YOUR_COMPUTER_LAN_IP` with your computer's local IPv4 address (for example, `192.168.1.20`). The device and computer must be on the same network. Do not use `localhost` on a physical device; it refers to the device itself.

For an Android emulator, use:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api
```

Start the backend and verify `http://YOUR_COMPUTER_LAN_IP:4000/health` is reachable from the device's browser; it should return `{"status":"ok","service":"connectmytask-api"}`. If it is not reachable, check that the backend is running on port `4000` and that your computer's firewall allows connections to that port. The Expo tunnel used by `npm run ipad` only serves the app bundle; it does not tunnel API requests. Restart Expo after changing `.env`.

Run mobile:

```bash
# Android emulator (Windows/macOS/Linux)
npm run android

# Real iPad/iPhone via Expo Go tunnel (Windows/macOS/Linux)
npm run ipad

# iOS simulator (macOS only)
npm run ios
```

From project root, you can also use:

```bash
npm run mobile:android
npm run mobile:ipad
npm run mobile:ios
```

### 4) Quick smoke test

1. Open web at `http://localhost:5173`.
2. Register a new account.
3. Login with that account.
4. Browse tasks and create a task.
5. Confirm new task appears in browse list.

If register/login fails on another machine, 90% of cases are:

- Wrong `DATABASE_URL` in root `.env`
- Forgot `npx prisma generate`
- Forgot `npx prisma db push`
- Web `.env` still points to wrong API port
- Backend is not running on `4000`

### Tech Stack

- **Runtime**: Node.js (CommonJS)
- **Framework**: Express.js
- **Database**: PostgreSQL + Prisma ORM
- **Real-time**: Socket.io
- **HTTP Client**: Axios (AI integration)
- **Validation**: Zod
- **Containerisation**: Docker

### Project Structure

- `src/server.js` – HTTP + Socket.io bootstrap
- `src/app.js` – Express app, middleware, and route mounting
- `src/config/env.js` – Environment variable handling
- `src/database/prisma.js` – Prisma client singleton
- `src/shared/` – Cross-cutting helpers (logging, errors, validation, socket)
- `src/modules/` – Modular monolith feature modules:
  - `users/`
  - `tasks/`
  - `bids/`
  - `reviews/`
  - `tracking/` (provider GPS sharing and task-site arrival verification)
  - `ai-integration/` (AI orchestration layer)

### Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

- `NODE_ENV` – `development` | `production`
- `PORT` – HTTP port (default `4000`)
- `DATABASE_URL` – Postgres connection string (Prisma)
- `AI_SERVICE_URL` – Base URL of external AI service (e.g. `http://ai-service`)

### Database & Prisma

1. Ensure PostgreSQL is running and the database exists:

```bash
createdb connectmytask
```

2. Create tables (recommended for local development):

```bash
npx prisma db push
```

If you enable the login lockout feature, ensure migrations include new user fields:

```bash
npx prisma migrate dev --name add-login-lockout-fields
```

3. Generate Prisma client:

```bash
npx prisma generate
```

### Migrations & Seed

Run migrations:

```bash
npm run prisma:migrate
```

Seed database:

```bash
npm run prisma:seed
```

Seed output includes requester credentials and created task count.

Notes:

- If your DB user does not have permission on the `public` schema, set `DATABASE_URL` to use a dedicated schema (example: `...?schema=app`) and create it once:

```bash
echo "CREATE SCHEMA IF NOT EXISTS app;" | npx prisma db execute --stdin
```

### Running Locally

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Run in production mode:

```bash
npm run start
```

The API will be available at `http://localhost:4000`.

### Core REST Endpoints

All routes are prefixed with `/api` unless noted.

- **Tasks**
  - `POST /api/tasks` – Create a task
  - `GET /api/tasks` – List tasks (optional `status`, `category` query)
  - `GET /api/tasks/:id` – Get task details
  - `PATCH /api/tasks/:id/status` – Update task status

- **Bids**
  - `POST /api/bids` – Create a bid
  - `GET /api/tasks/:id/bids` – List bids for a task
  - `POST /api/bids/:id/accept` – Accept a bid (assigns provider and rejects others)

- **Reviews**
  - `POST /api/reviews` – Create a review
  - `GET /api/providers/:id/reviews` – List reviews for a provider

- **Tracking (Provider GPS)**
  - `GET /api/tracking/tasks/:taskId/site-location` – Get requester-set coordinates for a task participant
  - `GET /api/tracking/tasks/:taskId/latest` – Get the latest in-memory provider location (expires after two minutes)
  - `GET /api/tracking/tasks/:taskId/history` – Return an empty list; journey history is not stored
  - `GET /api/tracking/tasks/:taskId/verification` – Get arrival-verification status
  - `POST /api/tracking/tasks/:taskId/verify` – Verify the assigned provider is within 1 km of the task site after escrow funding
  - `POST /api/tracking/update`

All tracking routes require authentication. Location writes are accepted only from the provider assigned to an active task. The provider identity is taken from the authenticated account; `providerId` is optional and, if supplied, must match it. Journey updates replace one temporary latest point in API memory; they are not written to the `TRACKING_LOGS` database table. The latest point expires after two minutes and is lost on API restart. Location-verification evidence is persisted separately to enforce verification and expiry gates.

Example update body:

```json
{
  "taskId": 1,
  "lat": 10.7769,
  "lng": 106.7009,
  "accuracy": 12,
  "timestamp": "2026-10-24T06:00:00.000Z"
}
```

Use a current UTC timestamp when sending an update; the backend rejects stale GPS samples.

Flow:

- Task maps are available to the requester and assigned provider for that task.
- The assigned provider can opt in to foreground GPS sharing from the mobile app after requester escrow funding is confirmed. GPS tracking and precise task-address access are unavailable before funding.
- The provider's mobile **Verify location** action checks a fresh GPS point within 1 km of the saved task-site coordinates; escrow must be funded before verification.
- The requester can view the provider's latest location on web or mobile. The requester marker represents the saved task location, not the requester's live device location.
- Persisted into `TRACKING_LOGS` via Prisma.

- **AI Integration**
  - `POST /api/ai/recommend/:taskId`

Flow:

1. Fetch task from DB.
2. Call external AI service:

   - **URL**: `POST ${AI_SERVICE_URL}/recommend`
   - **Payload**:

   ```json
   {
     "category": "Cleaning",
     "description": "Clean a 3 bedroom apartment",
     "location": "Melbourne CBD",
     "budget": 150
   }
   ```

3. Expect response:

   ```json
   {
     "suggestedPrice": 160,
     "recommendedProviders": [1, 2, 3],
     "confidenceScore": 0.92
   }
   ```

4. Store in `AI_INSIGHTS` table.
5. Return structured JSON to frontend with the same fields (`taskId`, `suggestedPrice`, `recommendedProviders`, `confidenceScore`).

### Task GPS Tracking

- The web and mobile task maps poll the authenticated `GET /api/tracking/tasks/:taskId/latest` endpoint every five seconds.
- Provider location is collected only while the assigned provider opts in from the mobile app with foreground location permission.
- The requester-set task pin is loaded from the participant-only `GET /api/tracking/tasks/:taskId/site-location` endpoint.
- Tracking map updates use HTTP polling. Socket.io is initialized by the backend but is not used for tracking location updates.
- The API holds only the latest journey point in memory for up to two minutes; it does not store journey history in the database. The history endpoint returns an empty list. Persisted location-verification evidence is separate from journey tracking.

### Docker Usage

Build the image:

```bash
docker build -t connectmytask-api .
```

Run the container (with Postgres available and envs set):

```bash
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/connectmytask?schema=public" \
  -e AI_SERVICE_URL="http://ai-service" \
  --name connectmytask-api \
  connectmytask-api
```

You can then point:

- **Frontend (React)** at `http://localhost:4000/api/...`
- **AI Service (FastAPI)** at the host / network name you configure in `AI_SERVICE_URL`
- **Mobile app** at the backend API URL; the assigned provider's app sends authenticated foreground GPS updates to `/api/tracking/update`.
