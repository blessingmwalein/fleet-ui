# FleetCore — Architecture & Build Contract

Enterprise Fleet Management ERP (frontend simulation). React 19 + TypeScript 7 (native tsc) + Vite 8 + Tailwind v4 +
Radix (shadcn-style, hand-written in `src/components/ui`) + Zustand + TanStack Table **v8** + React Hook Form + Zod 4 +
Recharts 3 + Framer Motion + React Router 7 (data router) + MapLibre GL. **Read this whole file before writing code.**

```
npm run dev                         # dev server (usually already running on http://127.0.0.1:5173)
npx tsc -p tsconfig.app.json --noEmit   # type-check (must be clean for YOUR files)
node scripts/shot.mjs <route> <out.png> [w] [h] [waitMs] [theme] [fullPage]   # headless Edge screenshot + console errors
```
Pass routes WITHOUT a leading slash in Git Bash (`vehicles`, not `/vehicles`). Screenshots go to `.screens/` (gitignored); view them with the Read tool.
`scripts/shot.mjs` also exports `open(route, opts)` returning `{ page, logs }` (Playwright) — write small scripts in `.screens/` to click through your UI and assert behaviour.
Do **not** create files with bash heredocs (they break in this shell) — use the Write/Edit tools.

TS config is strict with `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` (**no enums, no constructor parameter properties, no namespaces**), `verbatimModuleSyntax` (use `import type`). Path alias `@/` → `src/`.

## 1. Folder map

```
src/
  types/index.ts            domain model (READ IT)
  data/seed/*               deterministic demo dataset generator (50 vehicles, 46 drivers, ~2000 trips, ...)
  data/routes.ts            21 real road-following routes (OSRM geometry); places.ts gazetteer
  store/db.ts               THE database (zustand). CRUD + audit + persistence overlay
  store/{ui,settings,session,live,notifications,confirm}.ts
  services/                 simulation.ts (GPS), eventSimulator.ts, events.ts (bus), realtime.ts
  hooks/                    useAuth, useFilters, useMoney, useLookup, useOptions, useMediaQuery, useNavBadges
  lib/                      utils (cn…), format, csv, geo, rng, analytics (time buckets), navigation
  config/                   navigation.ts (sidebar/routes/RBAC), permissions.ts, status.ts (badges/labels)
  components/
    ui/                     primitives: button, form-controls, overlays (Dialog/Sheet/Popover/Tooltip/AlertDialog), menus (Dropdown/Select/Tabs/ScrollArea),
                            display (Badge/Avatar/StatusDot), command (Command/Combobox), segmented, sonner
    shared/                 Page/PageHeader/Panel/DetailGrid/Timeline/Can, KpiCard, Status/CategoryBadge/ExpiryBadge/Plate, EntityLink, EmptyState, StubPage
    data-table/DataTable.tsx   reusable table (search, facets, sort, paginate, columns, selection, bulk, CSV, mobile cards)
    forms/                  fields.tsx (RHF+zod field components), FormDialog.tsx
    charts/charts.tsx       TimeSeriesChart, DonutChart, BarList, Sparkline, ChartCard, CHART_COLORS
    layout/                 AppShell, Sidebar, Topbar, CommandPalette, NotificationCenter, Breadcrumbs (don't edit)
  features/<module>/        YOUR code. `routes.tsx` is the module's route table.
  app/router.tsx            composes every module's routes (don't edit)
```

## 2. Ownership rules (parallel work!)

Several agents build modules **at the same time** in the same repo.
* You own **only** `src/features/<your module>/**`. Create as many files as you need there.
* Do **not** edit other modules' folders, `src/app/router.tsx`, `src/config/*`, `src/store/*`, `src/data/*`, `src/types/*`, or `src/components/layout/*`.
* Need something shared? Create a **new** file (e.g. `src/lib/<yourthing>.ts` or `src/components/shared/<Thing>.tsx`) with a distinctive name. Small bug-fixes to existing shared components are allowed if truly necessary — keep them minimal & backwards compatible and mention them in your final report.
* If you need a new field on a type or a new collection, **do not** change `types/` — keep derived values in your module, or tell the lead in your final report.
* `npx tsc` shows errors from other agents' half-finished files. Ignore errors outside your folder; make sure your own files are clean.
* Replace the `StubPage` entries in `features/<module>/routes.tsx` with real lazy pages. **Every path listed for your module in `docs/MODULES.md` must render a complete, populated screen** — no placeholders.

Route table pattern (code-split pages):
```tsx
export const vehicleRoutes: RouteObject[] = [
  { path: 'vehicles', lazy: async () => ({ Component: (await import('./VehiclesPage')).default }) },
  { path: 'vehicles/:id', lazy: async () => ({ Component: (await import('./VehicleDetailPage')).default }) },
]
```

## 3. Data layer

Everything lives in `useDb` (zustand). Collections (see `DbData` in `data/seed/index.ts`):
`branches, departments, roles, users, geofences, vehicles, drivers, documents, customers, trips, shipments, fuelStations, fuelCards, fuelTransactions, providers, workOrders, schedules, inspections, incidents, safetyEvents, expenses, invoices, budgets, auditLog, dailyStats`.

```ts
const vehicles = useDb((s) => s.vehicles)                       // reactive read
const created = useDb.getState().insert('vehicles', { ...fieldsWithoutId })   // returns record with generated id (veh-051)
useDb.getState().update('vehicles', id, { status: 'maintenance' }, { action: 'status', summary: 'Changed AAC 1234 status to Maintenance' })
useDb.getState().remove('trips', id)  ;  updateMany / removeMany for bulk actions
useDb.getState().nextId('workOrders')
```
* Every mutation writes an **audit log** entry automatically (pass `{ silent: true }` to skip, `{ summary, action }` to customise). Use `action: 'status' | 'assign' | 'approve'` where relevant.
* Persistence: only the *changes* are stored in localStorage (overlay on top of the deterministic seed) — nothing to do.
* All **money is USD**. Display with `const money = useMoney(); money(1234.5)` (handles USD / ZiG toggle) — never hardcode `$`. `money(n, { compact: true })` for KPIs.
* Dates are ISO strings. Format with `fmtDate/fmtDateTime/timeAgo/fmtDuration/fmtNumber/fmtKm` from `lib/format`.
* Lookups: `const getVehicle = useById('vehicles'); getVehicle(id)` (O(1)); non-reactive `getById('vehicles', id)`. Option lists: `useVehicleOptions()`, `useDriverOptions()`, `useCustomerOptions()`, `useBranchOptions()`, `useProviderOptions()`.
* **Live telemetry**: `useLive((s) => s.telemetry[vehicleId])` → `{ lat, lng, speedKph, heading, state ('moving'|'idle'|'stopped'|'maintenance'|'offline'), fuelPct, odometerKm, location, remainingKm, etaTs, tripId, gpsOnline, ... }`. Updates every ~2 s. Effective live status of a vehicle = telemetry.state.
* The GPS simulator mutates trips (`in_transit → completed`, auto-creates return trips), safety events, fuel transactions and incidents while the app runs — your screens must tolerate data changing under them.
* Global filters (top bar): `useDateRange()` → `{ from, to, prevFrom, prevTo, days, label, inRange(iso), inPrevRange(iso) }` and `useBranchScope()` → `{ branchId, scope(items) }` (items with `branchId`). **Dashboards, analytics, charts and reports MUST honour both.** List pages should honour the branch scope too (apply `scope()` to the base data); lists need not filter by date unless it makes sense.
* Time-series helpers in `lib/analytics.ts`: `autoGranularity(days)`, `makeBuckets(from,to,g)`, `sumByBucket(items, buckets, getDate, getValue)`, `avgByBucket`, `countBy`, `sumBy`. `dailyStats` holds telematics daily aggregates (utilisation %, driving/idle hours, distance, fuel).

### GOTCHA — TanStack Table caches accessor values until `data` changes
Do **not** close over live/external state (telemetry, lookups that change) inside `accessorFn`/columns and expect it to refresh. Instead build **enriched row objects** in a `useMemo` that depends on that state and pass them as `data`:
```tsx
const rows = useMemo(() => vehicles.map((v) => ({ ...v, live: telemetry[v.id], driverName: getDriver(v.driverId)?.name ?? '' })), [vehicles, telemetry, drivers])
```
Accessors should return **plain searchable/sortable/exportable text or numbers** (e.g. driver *name*); put links/badges in `cell`. Global search & CSV export use accessor values.

## 4. Cross-module conventions (strict)

* **Entity links**: whenever you display another entity, use `<EntityLink type=… id=…/>` (or `VehicleLink`, `DriverLink`, `TripLink`, `CustomerLink`, `ShipmentLink`, `BranchLink`). Trips open the global drawer (`useUi.getState().openTrip(id)`); others navigate. Route map: vehicle `/vehicles/:id`, driver `/drivers/:id`, shipment `/shipments/:id`, customer `/customers/:id`; list pages with drawers use `?open=<id>` (`workorder → /maintenance/work-orders?open=`, `incident → /safety/incidents?open=`, `expense → /finance/expenses?open=`, `invoice → /finance/invoices?open=`, `fuel → /fuel/transactions?open=`, `branch → /admin/organisation?branch=`, `user → /admin/users?open=`, `document → /safety/compliance?open=`). Use `const [openId, setOpenId] = useOpenParam()` from `hooks/useLookup` to implement them.
* **`?new=1`**: list pages that create records open their create dialog when `?new=1` is present (the top-bar *Create* menu and ⌘K link to it): `/vehicles`, `/drivers`, `/dispatch` (new trip), `/shipments`, `/customers`, `/maintenance/work-orders`, `/fuel/transactions`, `/safety/incidents`, `/finance/expenses`, `/finance/invoices`. Read it with `useSearchParams`, open the dialog, then remove the param.
* **RBAC**: gate create/edit/delete/approve controls with `const can = useCan('vehicles.edit')` or `<Can perm="vehicles.delete">`. Permission keys are `${module}.${view|create|edit|delete|approve|export}` (modules: dashboard, tracking, vehicles, drivers, dispatch, shipments, maintenance, fuel, finance, safety, reports, admin). Route-level view access is enforced by the shell. Users can preview roles via the user menu → *Switch role (demo)*.
* **Confirmations**: `if (await confirm({ title, description, destructive: true })) …` (`store/confirm`). Never use `window.confirm/alert`.
* **Feedback**: `toast.success('…')` / `toast.error('…')` from `sonner` after every mutation.
* **Forms**: always `FormDialog` (or `variant="sheet"` for long forms) with a Zod schema + the field components in `components/forms/fields` (`TextField, NumberField, SelectField, ComboField, DateField, TextAreaField, SwitchField, FormSection, FormGrid`). Validate meaningfully (required, ranges, formats, cross-field with `.refine`). Convert dates with `toInputDate/fromInputDate`. `SelectField` can't have empty-string items; use `allowEmpty`. Pre-fill when editing via `defaultValues`.
* **Tables**: always `DataTable` with a unique `tableId`, `exportName`, `facets`, `selectable` + `bulkActions` where bulk operations make sense, `mobileCard` for phones, `actionsColumn` for row actions, `onRowClick` to open detail. Set explicit column `size`s (`size: 110`) so names don't truncate.
* **Detail views**: Sheet drawers (`Sheet/SheetContent size="lg"`) for quick views; full pages with `Tabs` for vehicles/drivers/shipments. Always add related-entity links and a back path.
* **Export**: any table with `exportName` gets CSV. Reports/analytics add an Export button that calls `downloadCsv()`/`downloadObjectsCsv()` from `lib/csv`.
* **Charts**: use `components/charts/charts.tsx` (Recharts). Colors only from `CHART_COLORS` / semantic vars — green primary, blue secondary, amber warning, red critical; no random rainbow. Every chart needs a title, tooltip, and — where it has multiple series — the built-in legend toggles. Wrap in `ChartCard` with optional `Segmented` controls (granularity, metric).
* **Never** hand-roll modals, tables or selects; never use `alert()`; never leave a button without an effect; never ship a placeholder.

## 5. Visual language

Dark-first enterprise UI (light theme supported — always use theme tokens, never hex colours). Information-dense but calm:
* Base text is 13px (`text-[13px]`); secondary `text-xs text-muted-foreground`; labels `.label-xs`. Numbers use `.num` (tabular). Registrations use `<Plate>`.
* Surfaces: `bg-background` < `.panel` (card) < `bg-surface-2` < `bg-surface-3`; borders `border-border`. Radius is `rounded-md/lg`. No heavy shadows/gradients/glass.
* Layout: every page = `<Page><PageHeader title description actions /> … </Page>`; group content in `<Panel title actions>`; KPI rows use `grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3` of `<KpiCard>` (compact, never oversized). Use `gap-3`/`gap-4`. No wasted whitespace.
* Semantic color: success=green, info=blue, warning=amber, danger=red (`Badge tone`, `Status`, `text-success`, `bg-danger/15`…). Primary action buttons are green (`<Button>`), secondary `variant="outline"`.
* Motion (Framer Motion) is subtle: fades/slides ≤200ms, count-up KPIs (already in KpiCard), `AnimatePresence` for list inserts/drawers. Skeletons for loading (`Skeleton`). Respect usability — no looping decoration.
* Responsive: desktop-first but must work at 390px: stack grids (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-…`), `DataTable mobileCard`, drawers go full width, toolbars wrap. Test with `node scripts/shot.mjs <route> out.png 390 844`.
* Accessibility: labelled controls, `aria-label` on icon-only buttons, visible focus rings (already in primitives).

## 6. Realism requirements
All screens must be driven by the existing dataset (never hardcode fake rows). Cross-reference properly (vehicle → driver → trips → fuel → expenses…). Use Zimbabwean context (Harare, Bulawayo, Mutare, Gweru, Kwekwe, Masvingo, Chinhoyi, Beitbridge; ZINARA, VID, ZIMRA, ZiG). Fuel in litres, distance in km, speeds km/h, currency via `useMoney()`.

## 7. Definition of done (per module)
1. Every route of your module renders a full, populated, interactive screen; `?new=1` / `?open=` deep links work.
2. `npx tsc -p tsconfig.app.json --noEmit` clean for your files.
3. You loaded each page with `scripts/shot.mjs` at 1440×900 **and** 390×844 (dark; spot-check light) with **no console errors**, looked at the screenshots, and fixed layout problems (truncation, overflow, empty areas).
4. You exercised the main interactions with a Playwright script (create → appears in table; edit; delete w/ confirm; filter; sort; export button; drawer opens; navigation to related entities) and fixed what broke.
5. Final report to the lead (≤25 lines): files created, routes covered, any shared-code edits, known gaps.
