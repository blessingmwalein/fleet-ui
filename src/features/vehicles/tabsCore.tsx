import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { startOfMonth, subMonths } from 'date-fns'
import { AlertTriangle, ArrowRight, CheckCircle2, Navigation, Pencil, Plus, Satellite, SatelliteDish, XCircle } from 'lucide-react'
import type { Vehicle } from '@/types'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { useById } from '@/hooks/useLookup'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Switch } from '@/components/ui/form-controls'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { DetailGrid, Panel, Timeline } from '@/components/shared/Page'
import { BranchLink, DriverLink, CustomerLink, TripLink } from '@/components/shared/EntityLink'
import { CategoryBadge, ExpiryBadge, Plate } from '@/components/shared/Status'
import { EmptyState } from '@/components/shared/EmptyState'
import { ChartCard, TimeSeriesChart } from '@/components/charts/charts'
import { Status } from '@/components/shared/Status'
import { makeBuckets, sumByBucket } from '@/lib/analytics'
import { fmtDate, fmtDateTime, fmtKm, fmtNumber, timeAgo } from '@/lib/format'
import { VEHICLE_CATEGORY } from '@/config/status'
import { cn } from '@/lib/utils'
import { ProgressBar, Stat } from './components'
import { bookValue, compass, isOtherExpense, vehicleAgeYears, woCost } from './lib'
import type { ShowVehicleDialog } from './VehicleDialogs'
import type { VehicleKpis } from './useVehicleKpis'
import { useVehicleExpenses, useVehicleFuel, useVehicleWorkOrders } from './useVehicleData'
import { toTimeline, useVehicleActivity } from './ActivityTab'

interface TabProps {
  vehicle: Vehicle
  kpis: VehicleKpis
  show: ShowVehicleDialog
  goTab: (tab: string) => void
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
export function OverviewTab({ vehicle: v, kpis, show, goTab }: TabProps) {
  const canEdit = useCan('vehicles.edit')
  const money = useMoney()
  const fuel = useVehicleFuel(v.id)
  const workOrders = useVehicleWorkOrders(v.id)
  const expenses = useVehicleExpenses(v.id)
  const activity = useVehicleActivity(v)
  const { live, activeTrip, upcomingTrips } = kpis

  const chart = useMemo(() => {
    const buckets = makeBuckets(startOfMonth(subMonths(new Date(), 5)), new Date(), 'month')
    const f = sumByBucket(fuel, buckets, (x) => x.date, (x) => x.totalUsd)
    const m = sumByBucket(workOrders.filter((w) => w.status === 'completed'), buckets, (w) => w.completedAt, woCost)
    const o = sumByBucket(expenses.filter(isOtherExpense), buckets, (e) => e.date, (e) => e.amountUsd)
    return buckets.map((b, i) => ({ label: b.label, title: b.title, fuel: Math.round(f[i]!), maintenance: Math.round(m[i]!), other: Math.round(o[i]!) }))
  }, [fuel, workOrders, expenses])
  const total6m = chart.reduce((s, r) => s + r.fuel + r.maintenance + r.other, 0)

  const progress = live && live.routeLengthM > 0 && activeTrip ? Math.min(100, (live.progressM / live.routeLengthM) * 100) : null
  const healthTone = kpis.health >= 80 ? 'primary' : kpis.health >= 60 ? 'warning' : 'danger'

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title="Current assignment"
        description={activeTrip ? 'Vehicle is on the road' : 'No active trip'}
        actions={activeTrip ? <Status kind="trip" value={activeTrip.status} /> : undefined}
      >
        {activeTrip ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold"><TripLink id={activeTrip.id} /></div>
                <div className="text-[13px] text-muted-foreground">{activeTrip.origin.name}, {activeTrip.origin.city} <ArrowRight className="mx-1 inline size-3" /> {activeTrip.destination.name}, {activeTrip.destination.city}</div>
              </div>
              {live?.speeding && <Badge tone="danger">Speeding {Math.round(live.speedKph)} / {live.limitKph} km/h</Badge>}
            </div>
            {progress !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(progress)}% complete{live ? ` · ${fmtNumber(live.remainingKm)} km remaining` : ''}</span>
                  <span>{live?.etaTs ? `ETA ${fmtDateTime(live.etaTs)}` : `Planned end ${fmtDateTime(activeTrip.plannedEnd)}`}</span>
                </div>
                <ProgressBar pct={progress} tone={live?.delayed ? 'warning' : 'primary'} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Driver" value={<DriverLink id={activeTrip.driverId} avatar />} />
              <Stat label="Customer" value={<CustomerLink id={activeTrip.customerId} />} />
              <Stat label="Cargo" value={activeTrip.cargoDescription} sub={`${fmtNumber(activeTrip.cargoWeightKg)} kg`} />
              <Stat label="Distance" value={fmtKm(activeTrip.plannedDistanceKm)} sub={activeTrip.delayMinutes > 0 ? `${activeTrip.delayMinutes} min delayed` : 'On schedule'} />
            </div>
            <Button size="sm" variant="outline" onClick={() => goTab('live')}><Navigation /> View live location</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              {v.status === 'active' ? `${v.reg} is not on a trip right now${live ? ` (${live.state}${live.speedKph ? '' : ''})` : ''}.` : `${v.reg} is ${v.status === 'maintenance' ? 'in the workshop' : 'out of service'} and unavailable for dispatch.`}
            </p>
            <div className="label-xs">Upcoming trips</div>
            {upcomingTrips.length === 0 ? (
              <p className="text-xs text-subtle-foreground">No trips scheduled. Create one from the Dispatch board.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {upcomingTrips.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate"><TripLink id={t.id} /> <span className="text-muted-foreground">· {t.origin.city} → {t.destination.city}</span></span>
                    <span className="num shrink-0 text-xs text-muted-foreground">{fmtDateTime(t.scheduledStart)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Health & compliance" description={`Overall score ${kpis.health}/100`} actions={<Badge tone={healthTone === 'primary' ? 'success' : healthTone}>{kpis.health >= 80 ? 'Good' : kpis.health >= 60 ? 'Fair' : 'Needs attention'}</Badge>}>
        <ProgressBar pct={kpis.health} tone={healthTone} className="mb-3 h-2" />
        <ul className="space-y-2 text-[13px]">
          {kpis.compliance.items.map((c) => (
            <CheckRow key={c.type} ok={c.state === 'valid' ? 'ok' : c.state === 'expiring' ? 'warn' : 'bad'} label={c.label}>
              {c.doc ? <ExpiryBadge iso={c.doc.expiryDate} /> : <Badge tone="danger">Missing</Badge>}
            </CheckRow>
          ))}
          <CheckRow ok={kpis.service.overdue ? 'bad' : kpis.service.state === 'due_soon' ? 'warn' : 'ok'} label="Service status">
            <span className={cn('text-xs', kpis.service.overdue && 'font-medium text-danger')}>
              {kpis.service.schedule ? (kpis.service.overdue ? `${kpis.service.overdueCount} overdue` : `Next ${fmtDate(kpis.service.dueTs)}`) : 'No schedule'}
            </span>
          </CheckRow>
          <CheckRow ok={kpis.fuelPct < 15 ? 'bad' : kpis.fuelPct < 30 ? 'warn' : 'ok'} label="Fuel level"><span className="num text-xs">{kpis.fuelPct}%</span></CheckRow>
          <CheckRow ok={kpis.gpsDown ? 'bad' : 'ok'} label="GPS / telematics"><span className="text-xs">{kpis.gpsDown ? 'Offline' : live ? 'Reporting' : 'Awaiting fix'}</span></CheckRow>
          <CheckRow ok={kpis.openWorkOrders.length ? 'warn' : 'ok'} label="Open work orders"><span className="num text-xs">{kpis.openWorkOrders.length}</span></CheckRow>
          <CheckRow ok={kpis.incidents90 ? 'warn' : 'ok'} label="Incidents (90 days)"><span className="num text-xs">{kpis.incidents90}</span></CheckRow>
        </ul>
      </Panel>

      <ChartCard title="Operating cost — last 6 months" description={`${money(total6m)} total · fuel, maintenance and other expenses`} className="lg:col-span-2">
        <TimeSeriesChart
          data={chart}
          titleKey="title"
          stacked
          height={230}
          yFormat={(n) => money(n, { compact: true })}
          series={[
            { key: 'fuel', label: 'Fuel', type: 'bar', color: 'var(--chart-1)', format: (n) => money(n) },
            { key: 'maintenance', label: 'Maintenance', type: 'bar', color: 'var(--chart-3)', format: (n) => money(n) },
            { key: 'other', label: 'Tolls, allowances & other', type: 'bar', color: 'var(--chart-2)', format: (n) => money(n) },
          ]}
        />
      </ChartCard>

      <Panel title="Key facts" actions={canEdit ? <Button size="xs" variant="ghost" onClick={() => goTab('specs')}>All specs</Button> : undefined}>
        <DetailGrid
          columns={2}
          items={[
            { label: 'Registration', value: <Plate>{v.reg}</Plate> },
            { label: 'Category', value: <CategoryBadge category={v.category} /> },
            { label: 'Make / model', value: `${v.make} ${v.model}` },
            { label: 'Year', value: `${v.year} · ${v.colour}` },
            { label: 'VIN', value: <span className="font-mono text-xs">{v.vin}</span> },
            { label: 'Fuel / tank', value: `${v.fuelType} · ${v.tankCapacityL} L` },
            { label: 'Load capacity', value: `${fmtNumber(v.loadCapacityKg)} kg` },
            { label: 'Branch', value: <BranchLink id={v.branchId} /> },
            { label: 'Driver', value: <DriverLink id={v.driverId} avatar fallback="Unassigned" /> },
            { label: 'GPS device', value: <span className="font-mono text-xs">{v.deviceId}</span> },
          ]}
        />
      </Panel>

      <Panel className="lg:col-span-2" title="Recent activity" actions={<Button size="xs" variant="ghost" onClick={() => goTab('activity')}>View all <ArrowRight /></Button>}>
        {activity.length ? <Timeline items={toTimeline(activity.slice(0, 6))} /> : <EmptyState compact title="No activity yet" />}
      </Panel>

      <Panel title="Service & maintenance" actions={canEdit ? <Button size="xs" variant="soft" onClick={() => show({ kind: 'maintenance', vehicle: v })}><Plus /> Schedule</Button> : undefined}>
        <div className="space-y-3">
          <Stat
            label="Next service"
            value={kpis.service.schedule ? <span className={cn(kpis.service.overdue && 'text-danger')}>{kpis.service.schedule.task}</span> : '—'}
            sub={kpis.service.schedule ? `${kpis.service.overdue ? 'Overdue since' : 'Due'} ${fmtDate(kpis.service.dueTs)} · ${kpis.service.kmLeft! < 0 ? `${fmtNumber(-kpis.service.kmLeft!)} km over` : `${fmtNumber(kpis.service.kmLeft)} km left`}` : undefined}
          />
          <div>
            <div className="label-xs mb-1">Open work orders</div>
            {kpis.openWorkOrders.length === 0 ? (
              <p className="text-xs text-subtle-foreground">None — vehicle is clear of workshop jobs.</p>
            ) : (
              <ul className="space-y-1.5">
                {kpis.openWorkOrders.slice(0, 4).map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link to={`/maintenance/work-orders?open=${w.id}`} className="min-w-0 truncate hover:text-primary hover:underline">{w.woNo} · {w.title}</Link>
                    <Status kind="workorder" value={w.status} dot={false} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={() => goTab('maintenance')}>Open maintenance tab <ArrowRight /></Button>
        </div>
      </Panel>
    </div>
  )
}

function CheckRow({ ok, label, children }: { ok: 'ok' | 'warn' | 'bad'; label: string; children?: React.ReactNode }) {
  const Icon = ok === 'ok' ? CheckCircle2 : ok === 'warn' ? AlertTriangle : XCircle
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', ok === 'ok' ? 'text-success' : ok === 'warn' ? 'text-warning' : 'text-danger')} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Specifications                                                      */
/* ------------------------------------------------------------------ */
export function SpecsTab({ vehicle: v, show }: TabProps) {
  const canEdit = useCan('vehicles.edit')
  const money = useMoney()
  const age = vehicleAgeYears(v)
  const book = bookValue(v)
  const edit = canEdit ? <Button size="xs" variant="outline" onClick={() => show({ kind: 'edit', vehicle: v })}><Pencil /> Edit</Button> : undefined
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Identification" actions={edit}>
        <DetailGrid
          columns={1}
          items={[
            { label: 'Registration', value: <Plate>{v.reg}</Plate> },
            { label: 'Make', value: v.make },
            { label: 'Model', value: v.model },
            { label: 'Model year', value: v.year },
            { label: 'Category', value: VEHICLE_CATEGORY[v.category] },
            { label: 'Colour', value: v.colour },
            { label: 'VIN / chassis no.', value: <span className="font-mono text-xs">{v.vin}</span> },
            { label: 'Engine no.', value: <span className="font-mono text-xs">{v.engineNo}</span> },
          ]}
        />
      </Panel>
      <Panel title="Capacity & drivetrain" actions={edit}>
        <DetailGrid
          columns={1}
          items={[
            { label: 'Fuel type', value: <span className="capitalize">{v.fuelType}</span> },
            { label: 'Tank capacity', value: `${fmtNumber(v.tankCapacityL)} L` },
            { label: 'Load capacity', value: `${fmtNumber(v.loadCapacityKg)} kg` },
            { label: 'Axles', value: v.axles },
            { label: 'Seats', value: v.seats ?? '—' },
            { label: 'Home branch', value: <BranchLink id={v.branchId} /> },
            { label: 'Assigned driver', value: <DriverLink id={v.driverId} avatar fallback="Unassigned" /> },
            { label: 'Odometer (recorded)', value: fmtKm(v.odometerKm) },
          ]}
        />
      </Panel>
      <div className="space-y-4">
        <Panel title="Acquisition & valuation" actions={edit}>
          <DetailGrid
            columns={1}
            items={[
              { label: 'Purchase date', value: `${fmtDate(v.purchaseDate)} · ${age.toFixed(1)} yrs old` },
              { label: 'Purchase cost', value: money(v.purchaseCostUsd) },
              { label: 'Estimated book value', value: <span>{money(book)} <span className="text-xs text-subtle-foreground">straight-line, 10 yrs</span></span> },
              { label: 'Record created', value: fmtDate(v.createdAt) },
            ]}
          />
          <ProgressBar pct={(book / Math.max(1, v.purchaseCostUsd)) * 100} tone="info" className="mt-3" />
          <p className="mt-1 text-[11px] text-subtle-foreground">{Math.round((book / Math.max(1, v.purchaseCostUsd)) * 100)}% of purchase value remaining</p>
        </Panel>
        <Panel title="Telematics" actions={edit}>
          <DetailGrid
            columns={1}
            items={[
              { label: 'GPS device ID', value: <span className="font-mono text-xs">{v.deviceId}</span> },
              { label: 'Home base', value: <span className="num text-xs">{v.homeLat.toFixed(4)}, {v.homeLng.toFixed(4)}</span> },
            ]}
          />
        </Panel>
      </div>
      {v.notes && (
        <Panel title="Notes" className="lg:col-span-3"><p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{v.notes}</p></Panel>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Live location                                                       */
/* ------------------------------------------------------------------ */
export function LiveTab({ vehicle: v, kpis }: TabProps) {
  const live = kpis.live
  const [follow, setFollow] = useState(true)
  const getTrip = useById('trips')
  const trip = getTrip(live?.tripId)
  const markers = useMemo<MiniMapMarker[]>(() => [{ id: 'home', lat: v.homeLat, lng: v.homeLng, kind: 'depot', label: 'Home base' }], [v.homeLat, v.homeLng])
  const onRoute = !!live?.routeId && !!trip

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title="Live map"
        description={live ? `Position updates every few seconds · last fix ${timeAgo(live.lastFixTs)}` : 'Waiting for the first GPS fix'}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={follow} onCheckedChange={setFollow} aria-label="Follow vehicle" /> Follow
            </label>
            <Button asChild size="xs" variant="outline"><Link to={`/tracking?vehicle=${v.id}`}><Navigation /> Live tracking</Link></Button>
          </div>
        }
        flush
      >
        <MiniMap
          height={440}
          className="rounded-none border-0"
          vehicleId={v.id}
          markers={markers}
          follow={follow}
          routeId={onRoute ? (live!.routeId ?? undefined) : undefined}
          progressM={onRoute ? live!.progressM : undefined}
          routeDir={live?.routeDir}
        />
      </Panel>

      <Panel title="Telemetry" description={live ? live.location : 'No telemetry received yet'} actions={live ? <Badge tone={live.gpsOnline ? 'success' : 'danger'}>{live.gpsOnline ? <Satellite /> : <SatelliteDish />} {live.gpsOnline ? 'GPS online' : 'GPS offline'}</Badge> : undefined}>
        {live ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Stat label="State" value={<Status kind="live" value={live.state} />} />
            <Stat label="Engine" value={live.engineOn ? 'On' : 'Off'} />
            <Stat label="Speed" value={<span className={cn('num', live.speeding && 'text-danger')}>{Math.round(live.speedKph)} km/h</span>} sub={`Limit ${live.limitKph} km/h`} />
            <Stat label="Heading" value={<span className="num">{Math.round(live.heading)}° {compass(live.heading)}</span>} />
            <Stat label="Odometer" value={<span className="num">{fmtKm(live.odometerKm)}</span>} />
            <Stat label="Fuel" value={<span className={cn('num', live.fuelPct < 15 && 'text-danger')}>{Math.round(live.fuelPct)}% · {Math.round((live.fuelPct / 100) * v.tankCapacityL)} L</span>} />
            <Stat label="Coordinates" value={<span className="num text-xs">{live.lat.toFixed(5)}, {live.lng.toFixed(5)}</span>} className="col-span-2" />
            <Stat label="Last fix" value={fmtDateTime(live.lastFixTs)} sub={timeAgo(live.lastFixTs)} className="col-span-2" />
            {trip && (
              <>
                <Stat label="Trip" value={<TripLink id={trip.id} />} sub={`${trip.origin.city} → ${trip.destination.city}`} className="col-span-2" />
                <Stat label="Remaining" value={<span className="num">{fmtNumber(live.remainingKm)} km</span>} />
                <Stat label="ETA" value={live.etaTs ? fmtDateTime(live.etaTs) : '—'} sub={live.delayed ? 'Running late' : undefined} />
              </>
            )}
          </div>
        ) : (
          <EmptyState compact title="No telemetry yet" description={`Home base ${v.homeLat.toFixed(4)}, ${v.homeLng.toFixed(4)}`} />
        )}
      </Panel>
    </div>
  )
}
