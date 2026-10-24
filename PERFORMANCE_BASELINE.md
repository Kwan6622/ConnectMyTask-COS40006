# ConnectMyTask Performance Baseline

Captured on 2026-10-14 against the local Windows development environment. This is a starting point for comparisons, not a production SLA.

## Feature inventory and coverage

The project has a React web client, an Expo mobile client, and an Express/Prisma API. Main user journeys include:

- Sign-in, registration, profiles, and role-based requester/provider/admin dashboards.
- Browse, search, filter, post, save, and view tasks; submit bids and manage task progress.
- GPS task tracking and real-time updates, chat, notifications, ratings/reviews, and payments.
- AI-assisted task suggestions and pricing.

The baseline below measures the web production bundle, a local browser load, and the public task-list API. Authenticated dashboards, AI/external services, Socket.IO updates, and mobile-device rendering were not benchmarked.

## Measurements

| Metric | Baseline | Conditions |
| --- | ---: | --- |
| Web production JS bundle | 604.32 KB raw / 172.30 KB gzip | `npm --prefix frontend-web run build`; Vite transformed 1,134 modules |
| Web production CSS bundle | 77.77 KB raw / 12.35 KB gzip | Same production build |
| HTML entry | 1.57 KB raw / 0.65 KB gzip | Same production build |
| Production-preview navigation load event | 25.6–65.3 ms; median 31.3 ms | Five reloads in the integrated browser against the local Vite preview; warm-cache measurements |
| `GET /api/tasks` | 50.2, 12.7, 11.7, 11.6, 11.1 ms; median 11.7 ms | Five sequential local HTTP requests; all HTTP 200 |
| Task-list response body | 2 bytes (`[]`) | Local database currently returns no tasks |

The browser's production-preview paint entries were not available for a reliable FCP value in these runs. Do not treat the navigation-load measurement as FCP or as a cold-cache/user-network result. A first cold Vite development load also took about 8.7 seconds while Vite was compiling/optimizing dependencies; that development-only startup is excluded from the production measurements.

## Findings to investigate

1. **Large eager web entry bundle.** The production JS chunk exceeds Vite's 500 KB warning threshold. The app statically imports all page components in `frontend-web/src/App.tsx`; charts, maps, and authenticated areas are therefore candidates for route-level code splitting. The measured asset size is a direct signal; the user-visible impact should be retested after splitting.
2. **Task browse API is not bounded server-side.** The web client sends `page` and `limit` from `frontend-web/src/stores/task.store.ts`, but the task controller forwards the query to the service and `src/modules/tasks/repository.js`'s `listTasks` applies filters/order and includes related records without `take`/`skip`. It loads task counts, recent progress, and subtasks for every matching task. As the task table grows this can increase database work, response bytes, client normalization, and render time. Current empty-data latency cannot quantify that growth.
3. **Admin collections are also unbounded.** Admin task, certificate, and payment list queries use `findMany` with ordering/includes but no pagination limit in `src/modules/admin/repository.js`. Benchmark these with representative data and prioritize if admin list rendering or payload size grows.
4. **Mobile rendering remains unmeasured.** Expo screens, especially browse, dashboard, and admin lists, need device/emulator frame-time and memory measurements; web timings do not stand in for mobile performance.

## Reproduction

From the repository root:

```powershell
npm --prefix frontend-web run build
```

With the backend running locally, measure the public list endpoint five times:

```powershell
1..5 | ForEach-Object {
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-WebRequest -UseBasicParsing -Uri http://localhost:4000/api/tasks -TimeoutSec 30
  $timer.Stop()
  "status=$($response.StatusCode) durationMs=$($timer.Elapsed.TotalMilliseconds.ToString('F1')) bytes=$([Text.Encoding]::UTF8.GetByteCount($response.Content))"
}
```

For meaningful before/after comparisons, repeat with a fixed seeded dataset (including enough tasks, bids, subtasks, and progress updates to exercise the included relations), a clean browser cache, and the same machine/browser. Record response status, latency distribution, payload bytes, JS/CSS transfer size, FCP/LCP, and interaction/frame responsiveness. Keep development-server startup timings separate from production-build measurements.

Baseline highlights:
Web build succeeded, but Vite flagged the 604.32 KB JavaScript chunk (172.30 KB gzip) as exceeding its 500 KB threshold.
Five warm production-preview page loads had a 31.3 ms median navigation load event. This is not FCP and isn’t a cold-cache or real-network measurement.
Five local GET /api/tasks requests had an 11.7 ms median; the response was only [] (2 bytes), so this does not measure performance with realistic task data.
The first cold Vite development load took about 8.7 seconds, largely during dependency compilation/optimization; it is recorded separately from production measurements.
Likely hotspots to investigate: eager page imports contributing to the large web bundle; task and admin list queries that return unbounded results, with related data included. Mobile rendering, authenticated dashboards, and AI/realtime flows remain unbenchmarked. No optimization changes were made in this baseline pass.

Planned Optimizations:
Split the web app by route. The baseline measured a 604 KB JavaScript bundle, and App.tsx statically imports all the pages. Lazy-load routes so users download dashboards, admin tools, and less-frequently used screens only when needed. Maps, charts, and chat are good candidates to check for especially large feature-specific chunks.

Implement server-side pagination for task lists. The web store sends page and limit values in task.store.ts, but the baseline found that the task repository’s listTasks query does not bound its results. Apply validated filters, stable ordering, and skip/take in the database, and return pagination metadata. Avoid loading relations in the browse response unless that screen needs them.

Bound other growing collections. The admin task, certificate, and payment queries are also flagged as unbounded in the baseline. Add pagination there if realistic data shows those screens are slow or responses are large.

Keep mobile lists scalable. The Expo browse screen renders cards from a scroll view in browse-tasks.tsx. If profiling shows scrolling or memory problems as task counts increase, use a virtualized list and avoid fetching every task up front.

Improve the benchmark before tuning small details. Repeat tests with fixed seeded data—including tasks and the related records returned by the API—and capture payload size plus p50/p95 latency. For web, measure cold-cache LCP and interaction responsiveness separately from API time. For Android and iOS, profile frame times and memory on actual devices or suitable simulators.
