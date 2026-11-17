import { useMemo, type ReactNode } from 'react'
import { Activity, BadgeDollarSign, CheckCheck, Droplets, Gauge, Navigation, Route, Timer, Truck, Users, WifiOff, Wrench, type LucideIcon } from 'lucide-react'
import { autoGranularity, avgByBucket, makeBuckets, bucketIndex, sumByBucket } from '@/lib/analytics'
import { fmtNumber, toDate } from '@/lib/format'
import { useMoney } from '@/hooks/useMoney'
import { useNotifications } from '@/store/notifications'
import { pctChange, type Delta } from '@/components/shared/KpiCard'
import type { Tone } from '@/components/ui/display'
import { mean, sparkOrUndefined, statsBetween, sum, workOrderCost } from '../lib/periodStats'
import { useDash } from './useDashboardScope'
import type { FleetLive } from './useFleetLive'

export interface KpiModel {
  id: string
  label: string
  value: number
  format?: (n: number) => string
  unit?: string
  delta?: Delta
  sub?: ReactNode
  spark?: number[]
  sparkColor?: string
  status?: Tone
  icon: LucideIcon
  hint: ReactNode
  href: string
}

function Hint({ title, lines }: { title: string; lines: (string | false | undefined)[] }) {
  return (
    <div className="max-w-56 space-y-0.5">
      <div className="font-medium text-foreground">{title}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className="text-muted-foreground">{l}</div>
      ))}
    </div>
  )
}

/** Period metrics: independent of live telemetry, so they only recompute when data / filters change. */
function usePeriodMetrics() {
  const { range, trend, trips, fuel, workOrders, dailyStats, inScopeEntity } = useDash()
  const notifications = useNotifications((s) => s.items)
  return useMemo(() => {
    const buckets = makeBuckets(trend.from, trend.to, autoGranularity(trend.days))
    const inR = range.inRange
    const inP = range.inPrevRange

    const completed = trips.filter((t) => t.status === 'completed' && t.actualEnd)
    const deliveries = completed.filter((t) => inR(t.actualEnd)).length
    const deliveriesPrev = completed.filter((t) => inP(t.actualEnd)).length
    const deliveriesSpark = sumByBucket(completed, buckets, (t) => t.actualEnd)

    const started = trips.filter((t) => t.actualStart)
    const startedN = started.filter((t) => inR(t.actualStart)).length
    const startedPrev = started.filter((t) => inP(t.actualStart)).length
    const startedSpark = sumByBucket(started, buckets, (t) => t.actualStart)

    const fuelL = sum(fuel.filter((f) => inR(f.date)).map((f) => f.litres))
    const fuelPrev = sum(fuel.filter((f) => inP(f.date)).map((f) => f.litres))
    const fuelSpark = sumByBucket(fuel, buckets, (f) => f.date, (f) => f.litres)

    const doneWo = workOrders.filter((w) => w.status === 'completed' && w.completedAt)
    const maintCost = sum(doneWo.filter((w) => inR(w.completedAt)).map(workOrderCost))
    const maintPrev = sum(doneWo.filter((w) => inP(w.completedAt)).map(workOrderCost))
    const maintSpark = sumByBucket(doneWo, buckets, (w) => w.completedAt, workOrderCost)
    const woRequested = workOrders.filter((w) => inR(w.requestedAt)).length
    const woRequestedPrev = workOrders.filter((w) => inP(w.requestedAt)).length
    const woSpark = sumByBucket(workOrders, buckets, (w) => w.requestedAt)

    const stats = statsBetween(dailyStats, range.from, range.to)
    const statsPrev = statsBetween(dailyStats, range.prevFrom, range.prevTo)
    const util = mean(stats.map((s) => s.utilisationPct))
    const utilPrev = mean(statsPrev.map((s) => s.utilisationPct))
    const trendStats = statsBetween(dailyStats, trend.from, trend.to)
    const day = (s: { date: string }) => toDate(s.date)
    const utilSpark = avgByBucket(trendStats, buckets, day, (s) => s.utilisationPct)
    const activeSpark = avgByBucket(trendStats, buckets, day, (s) => s.activeVehicles)
    const inServiceSpark = avgByBucket(trendStats, buckets, day, (s) => s.inService)
    const movingSpark = avgByBucket(trendStats, buckets, day, (s) => s.drivingHours / 24)
    const idleSpark = sumByBucket(trendStats, buckets, day, (s) => s.idleHours)
    const idleHours = sum(stats.map((s) => s.idleHours))
    const idleHoursPrev = sum(statsPrev.map((s) => s.idleHours))
    const activeAvg = mean(stats.map((s) => s.activeVehicles))

    // distinct drivers driving per bucket
    const sets = buckets.map(() => new Set<string>())
    for (const t of started) {
      if (!t.driverId || !t.actualStart) continue
      const i = bucketIndex(buckets, toDate(t.actualStart).getTime())
      if (i >= 0) sets[i]!.add(t.driverId)
    }
    const driverSpark = sets.map((s) => s.size)

    const offlineSpark = sumByBucket(
      notifications.filter((n) => n.type === 'vehicle_offline' && inScopeEntity(n.entity)),
      buckets,
      (n) => n.ts,
    )

    return {
      deliveries, deliveriesPrev, deliveriesSpark, startedN, startedPrev, startedSpark, fuelL, fuelPrev, fuelSpark,
      maintCost, maintPrev, maintSpark, woRequested, woRequestedPrev, woSpark, util, utilPrev, utilSpark, activeSpark,
      inServiceSpark, movingSpark, idleSpark, idleHours, idleHoursPrev, activeAvg, driverSpark, offlineSpark,
    }
  }, [range, trend, trips, fuel, workOrders, dailyStats, notifications, inScopeEntity])
}

/** The 12 headline KPIs of the executive overview. */
export function useKpis(live: FleetLive): KpiModel[] {
  const { vehicles, drivers, trips, range } = useDash()
  const money = useMoney()
  const p = usePeriodMetrics()

  const driversActive = drivers.filter((d) => d.status === 'active').length
  const activeTrips = trips.filter((t) => t.status === 'in_transit' || t.status === 'delayed')
  const delayedTrips = activeTrips.filter((t) => t.status === 'delayed').length
  const driversOnTrip = new Set(activeTrips.map((t) => t.driverId).filter(Boolean)).size
  const inService = vehicles.filter((v) => v.status === 'active').length
  const outOfService = vehicles.filter((v) => v.status === 'out_of_service').length

  const c = live.counts
  const pctOfActive = live.active ? Math.round((c.moving / live.active) * 100) : 0
  const pctOfFleet = live.total ? Math.round((live.active / live.total) * 100) : 0

  return useMemo<KpiModel[]>(() => {
    const prevLabel = `vs prev. ${range.days}d`
    const period = range.label.toLowerCase()
    return [
      {
        id: 'total', label: 'Total vehicles', value: live.total, icon: Truck, href: '/vehicles', spark: sparkOrUndefined(p.inServiceSpark), sparkColor: 'var(--chart-2)',
        sub: `${inService} in service`,
        hint: <Hint title="Total vehicles" lines={[`${inService} active · ${c.maintenance} in maintenance · ${outOfService} out of service`, 'Sparkline: vehicles in service per day.']} />,
      },
      {
        id: 'active', label: 'Active vehicles', value: live.active, icon: Activity, href: '/tracking', status: 'success', spark: sparkOrUndefined(p.activeSpark),
        delta: p.activeAvg ? { pct: pctChange(live.active, p.activeAvg), label: 'vs daily avg' } : undefined,
        sub: `${pctOfFleet}% of fleet`,
        hint: <Hint title="Active vehicles (live)" lines={[`${c.moving} moving + ${c.idle} idle right now`, `Average vehicles active per day, ${period}: ${fmtNumber(p.activeAvg, 1)}`]} />,
      },
      {
        id: 'moving', label: 'On trip (moving)', value: c.moving, icon: Navigation, href: '/tracking', status: 'success', spark: sparkOrUndefined(p.movingSpark), sparkColor: 'var(--chart-1)',
        sub: `${pctOfActive}% of active fleet`,
        hint: <Hint title="Moving now" lines={['Vehicles currently driving (speed > 0).', 'Sparkline: average concurrently moving vehicles per day (driving hours ÷ 24).']} />,
      },
      {
        id: 'idle', label: 'Idle', value: c.idle, icon: Timer, href: '/tracking', status: live.total && c.idle / live.total > 0.25 ? 'warning' : undefined, spark: sparkOrUndefined(p.idleSpark), sparkColor: 'var(--chart-3)',
        delta: p.idleHoursPrev ? { pct: pctChange(p.idleHours, p.idleHoursPrev), goodWhen: 'down', label: 'idle hrs vs prev.' } : undefined,
        sub: 'Engine on, not moving',
        hint: <Hint title="Idle now" lines={[`Fleet idle time ${period}: ${fmtNumber(p.idleHours)} h (prev: ${fmtNumber(p.idleHoursPrev)} h)`, 'Engine on, vehicle stationary.']} />,
      },
      {
        id: 'maintenance', label: 'Under maintenance', value: c.maintenance, icon: Wrench, href: '/maintenance', status: c.maintenance ? 'warning' : undefined, spark: sparkOrUndefined(p.woSpark), sparkColor: 'var(--chart-3)',
        delta: p.woRequestedPrev ? { pct: pctChange(p.woRequested, p.woRequestedPrev), goodWhen: 'down', label: 'WOs vs prev.' } : undefined,
        sub: `${p.woRequested} work orders raised`,
        hint: <Hint title="In workshop" lines={[`${p.woRequested} work orders raised ${period} (prev: ${p.woRequestedPrev})`, 'Sparkline: work orders raised per period.']} />,
      },
      {
        id: 'offline', label: 'Offline', value: c.offline, icon: WifiOff, href: '/tracking', status: c.offline ? 'danger' : 'success', spark: sparkOrUndefined(p.offlineSpark), sparkColor: 'var(--chart-6)',
        sub: outOfService ? `${outOfService} out of service` : c.offline ? 'GPS not reporting' : 'All reporting',
        hint: <Hint title="Offline vehicles" lines={['GPS device not reporting, or vehicle out of service.', 'Sparkline: vehicle-offline alerts per period.']} />,
      },
      {
        id: 'drivers', label: 'Active drivers', value: driversActive, icon: Users, href: '/drivers', spark: sparkOrUndefined(p.driverSpark), sparkColor: 'var(--chart-2)',
        sub: `${driversOnTrip} driving · ${drivers.length - driversActive} off`,
        hint: <Hint title="Drivers" lines={[`${driversActive} active of ${drivers.length} on the register`, `${driversOnTrip} currently on an active trip`, 'Sparkline: distinct drivers dispatched per period.']} />,
      },
      {
        id: 'trips', label: 'Active trips', value: activeTrips.length, icon: Route, href: '/dispatch', status: delayedTrips ? 'warning' : 'success', spark: sparkOrUndefined(p.startedSpark), sparkColor: 'var(--chart-2)',
        delta: p.startedPrev ? { pct: pctChange(p.startedN, p.startedPrev), label: 'started vs prev.' } : undefined,
        sub: delayedTrips ? `${delayedTrips} delayed` : 'None delayed',
        hint: <Hint title="Trips on the road" lines={[`In transit ${activeTrips.length - delayedTrips} · delayed ${delayedTrips}`, `Trips started ${period}: ${p.startedN} (prev: ${p.startedPrev})`]} />,
      },
      {
        id: 'deliveries', label: 'Deliveries completed', value: p.deliveries, icon: CheckCheck, href: '/trips', status: 'success', spark: sparkOrUndefined(p.deliveriesSpark), sparkColor: 'var(--chart-1)',
        delta: { pct: pctChange(p.deliveries, p.deliveriesPrev), label: prevLabel },
        hint: <Hint title="Deliveries completed" lines={[`${period}: ${p.deliveries}`, `Previous period: ${p.deliveriesPrev}`]} />,
      },
      {
        id: 'fuel', label: 'Fuel consumption', value: p.fuelL, unit: 'L', format: (n) => fmtNumber(n), icon: Droplets, href: '/fuel', spark: sparkOrUndefined(p.fuelSpark), sparkColor: 'var(--chart-3)',
        delta: { pct: pctChange(p.fuelL, p.fuelPrev), goodWhen: 'down', label: prevLabel },
        hint: <Hint title="Fuel consumption" lines={[`Litres dispensed ${period}: ${fmtNumber(p.fuelL)}`, `Previous period: ${fmtNumber(p.fuelPrev)} L`]} />,
      },
      {
        id: 'utilisation', label: 'Fleet utilisation', value: p.util, unit: '%', format: (n) => n.toFixed(1), icon: Gauge, href: '/reports/fleet-utilisation', status: p.util >= 70 ? 'success' : p.util >= 50 ? 'warning' : 'danger', spark: sparkOrUndefined(p.utilSpark), sparkColor: 'var(--chart-1)',
        delta: p.utilPrev ? { pct: pctChange(p.util, p.utilPrev), label: prevLabel } : undefined,
        hint: <Hint title="Fleet utilisation" lines={[`Average share of in-service vehicles active per day, ${period}.`, `Previous period: ${p.utilPrev.toFixed(1)}%`]} />,
      },
      {
        id: 'maintSpend', label: 'Maintenance spend', value: p.maintCost, format: (n) => money(n, { compact: true }), icon: BadgeDollarSign, href: '/maintenance/work-orders', spark: sparkOrUndefined(p.maintSpark), sparkColor: 'var(--chart-4)',
        delta: p.maintPrev ? { pct: pctChange(p.maintCost, p.maintPrev), goodWhen: 'down', label: prevLabel } : undefined,
        hint: <Hint title="Maintenance expenditure" lines={[`Labour + parts on work orders completed ${period}: ${money(p.maintCost)}`, `Previous period: ${money(p.maintPrev)}`]} />,
      },
    ]
  }, [live.total, live.active, c.moving, c.idle, c.maintenance, c.offline, pctOfFleet, pctOfActive, inService, outOfService, driversActive, drivers.length, driversOnTrip, activeTrips.length, delayedTrips, p, range, money])
}
