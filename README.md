# FleetCore — Fleet Management ERP

A production-quality frontend simulation of an enterprise fleet / logistics ERP for a Zimbabwean transport operator
(Harare, Bulawayo, Mutare, Gweru, Kwekwe, Masvingo, Chinhoyi, Beitbridge). Everything is client-side: a deterministic
demo dataset, a GPS simulator that drives vehicles along real road geometry, and a live event stream.

> **Telemetry is simulated demo data**, not real GPS. The UI says so in the top bar and on the map.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # type-check + production build
npm run preview    # serve the build on :4173
```

Requires Node 20+. The map uses free, key-less basemaps (Carto vector styles, Esri imagery for satellite) and
OpenStreetMap Nominatim for address search, so it needs internet access.

## What's inside

| Area | Highlights |
| --- | --- |
| **Dashboard** | 12 live KPIs with period comparison + sparklines, 7 interactive charts honouring the global date range and depot scope, alerts, upcoming maintenance, expiring documents, incidents |
| **Live tracking** | MapLibre street map (dark/light/streets/satellite), clustering, 54 moving vehicles with type-specific top-down artwork, bold route highlighting with direction chevrons, geofences, simulated traffic, location search, follow / heading-up view, vehicle panel with exact location, trip progress & events |
| **Dispatch & trips** | Drag-and-drop kanban (7 statuses) with validation dialogs, trip list, trip drawer with route map, assign / dispatch / delay / complete (POD) / cancel |
| **Fleet** | Vehicles (10-tab detail), drivers (analytics, safety, documents), maintenance (calendar, work orders, schedules, inspections, providers), fuel (analytics, fraud flags, cards, stations, reconciliation) |
| **Business** | Shipments & customers (delivery timeline + map), finance (expenses approval, invoices, budgets, profitability), safety & compliance, 10 report categories with CSV export |
| **Administration** | Users, roles & permission matrix, organisation & geofences, notification preferences, audit log, settings (currency USD/ZiG, simulation controls) |

Cross-cutting: RBAC (preview roles from the user menu), command palette (`Ctrl/⌘ K`), notification centre fed by an event bus,
audit log on every mutation, dark/light themes, responsive layouts, CSV export, localStorage persistence of every change.

## Architecture in one minute

* `src/data/seed/*` — deterministic generator (seeded PRNG): 54 vehicles, 50 drivers, ~2,000 trips over 118 days, shipments, fuel,
  work orders, incidents, expenses, invoices… with consistent cross-references. Only *changes* are persisted (overlay), so the dataset
  can be large without hitting storage limits. **Reset demo data** is in the user menu.
* `src/data/routes.generated.ts` — 21 road-following routes baked from OSRM (`node scripts/build-routes.mjs` regenerates them).
* `src/store/db.ts` — the single database store (CRUD + audit); `store/live.ts` holds simulated telemetry.
* `src/services/simulation.ts` — GPS engine: fixes every N ms, smooth interpolation on the map, trip lifecycle, events.
  `services/events.ts` + `services/realtime.ts` are the seam where a WebSocket telematics feed would replace the simulator.
* `src/components/*` — design system (Radix-based primitives), DataTable, forms (RHF + Zod), charts (Recharts), layout shell.
* `src/features/<module>/` — one folder per module, each with its own `routes.tsx`.

More detail for contributors: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/MODULES.md`](docs/MODULES.md).

## Verification helpers

```bash
npx tsx --tsconfig tsconfig.app.json scripts/check-seed.ts   # dataset counts and referential integrity
node scripts/shot.mjs vehicles .screens/vehicles.png 1440 900 3000   # headless Edge screenshot + console errors
```
# fleet-ui
