import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, Fuel, Gauge, Route as RouteIcon, ShieldAlert, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import type { Driver } from '@/types'
import { useDb } from '@/store/db'
import { useDateRange } from '@/hooks/useFilters'
import { KpiCard, DeltaChip, pctChange } from '@/components/shared/KpiCard'
import { Panel } from '@/components/shared/Page'
import { Segmented } from '@/components/ui/segmented'
import { BarList, ChartCard, ChartTooltip, TimeSeriesChart } from '@/components/charts/charts'
import { SAFETY_EVENT_TYPE, expiryState } from '@/config/status'
import { autoGranularity, countBy, makeBuckets, type Granularity } from '@/lib/analytics'
import { fmtNumber } from '@/lib/format'
import { avg } from '@/lib/utils'
import { dispatchBlockers, tripDate } from '../driverData'
import { buildPerfContext, driverSeries, periodStats, radarMetrics, scoreTrend } from '../performance'

const COACHING: Record<string, string> = {
  speeding: 'Speed-management refresher — most flags are over-limit driving. Review the route speed limits with the driver.',
  harsh_braking: 'Defensive-driving and following-distance coaching — frequent harsh braking.',
  harsh_acceleration: 'Eco-driving session — smooth acceleration saves fuel and tyres.',
  harsh_cornering: 'Cornering and load-handling coaching, especially on laden trips.',
  fatigue: 'Review rest breaks and shift lengths — fatigue alerts recorded.',
  seatbelt: 'Seatbelt compliance reminder and spot-check.',
  phone_use: 'Mobile-phone policy review — zero tolerance while driving.',
  idling: 'Reduce excess idling to cut fuel waste.',
}

export function PerformanceTab({ driver }: { driver: Driver }) {
  const range = useDateRange()
  const trips = useDb((s) => s.trips)
  const events = useDb((s) => s.safetyEvents)
  const fuel = useDb((s) => s.fuelTransactions)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const [gran, setGran] = useState<'auto' | Granularity>('auto')
  const g = gran === 'auto' ? autoGranularity(range.days) : gran

  const ctx = useMemo(() => buildPerfContext(trips, events, fuel, vehicles), [trips, events, fuel, vehicles])
  const buckets = useMemo(() => makeBuckets(range.from, range.to, g), [range.from, range.to, g])
  const me = useMemo(() => periodStats(ctx, driver.id, range.inRange), [ctx, driver.id, range.inRange])
  const prev = useMemo(() => periodStats(ctx, driver.id, range.inPrevRange), [ctx, driver.id, range.inPrevRange])
  const fleet = useMemo(() => periodStats(ctx, null, range.inRange), [ctx, range.inRange])
  const series = useMemo(() => driverSeries(ctx, driver.id, buckets), [ctx, driver.id, buckets])
  const fleetAvgScore = useMemo(() => Math.round(avg(drivers.map((d) => d.safetyScore)) * 10) / 10, [drivers])
  const trend = useMemo(() => scoreTrend(ctx, driver, buckets).map((p) => ({ ...p, fleet: fleetAvgScore })), [ctx, driver, buckets, fleetAvgScore])

  const radar = useMemo(() => {
    const comp = (d: Driver) => (([d.licenceExpiry, d.medicalExpiry, d.defensiveDrivingExpiry].filter((x) => expiryState(x).state !== 'expired').length / 3) * 100)
    const perDriver = new Map<string, number>()
    for (const t of ctx.trips) if (t.status === 'completed' && t.driverId && range.inRange(tripDate(t))) perDriver.set(t.driverId, (perDriver.get(t.driverId) ?? 0) + 1)
    const best = Math.max(1, ...perDriver.values())
    const fleetTrips = [...perDriver.values()].reduce((s, n) => s + n, 0) / Math.max(1, drivers.length)
    const mine = radarMetrics(me, { safety: driver.safetyScore, compliancePct: comp(driver), tripsVsBest: (me.trips / best) * 100 })
    const all = radarMetrics(fleet, { safety: fleetAvgScore, compliancePct: avg(drivers.map(comp)), tripsVsBest: (fleetTrips / best) * 100 })
    return mine.map((m, i) => ({ metric: m.metric, driver: m.value, fleet: all[i]!.value }))
  }, [ctx, range, me, fleet, driver, drivers, fleetAvgScore])

  const fleetTripsPerDriver = Math.round((fleet.trips / Math.max(1, drivers.length)) * 10) / 10
  const eventTypes = useMemo(() => countBy(events.filter((e) => e.driverId === driver.id && range.inRange(e.timestamp)), (e) => e.type), [events, driver.id, range])
  const blockers = dispatchBlockers(driver)

  const recs = useMemo(() => {
    const out: { icon: LucideIcon; tone: string; text: string }[] = []
    const top = eventTypes[0]
    if (top && top[1] >= 2) out.push({ icon: ShieldAlert, tone: 'text-warning', text: COACHING[top[0]] ?? 'Review telematics events with the driver.' })
    if (me.eventsPer1000 !== null && fleet.eventsPer1000 !== null && me.eventsPer1000 > fleet.eventsPer1000 * 1.25) out.push({ icon: TriangleAlert, tone: 'text-danger', text: `Event rate (${me.eventsPer1000}/1,000 km) is ${Math.round((me.eventsPer1000 / Math.max(0.1, fleet.eventsPer1000) - 1) * 100)}% above the fleet average — schedule a ride-along assessment.` })
    if (me.onTimePct !== null && me.onTimePct < 80) out.push({ icon: Clock, tone: 'text-warning', text: `On-time delivery is ${me.onTimePct}% — review trip planning, loading delays and rest-stop discipline.` })
    if (me.fuelL100 !== null && me.fuelExpectedL100 && me.fuelL100 > me.fuelExpectedL100 * 1.08) out.push({ icon: Fuel, tone: 'text-warning', text: `Fuel use is ${Math.round((me.fuelL100 / me.fuelExpectedL100 - 1) * 100)}% above fleet average for the same vehicle types — eco-driving coaching recommended.` })
    for (const b of blockers.filter((x) => x.severity === 'block' || x.key === 'licence').slice(0, 2)) out.push({ icon: ShieldAlert, tone: 'text-danger', text: `${b.label} — resolve before the next dispatch.` })
    if (driver.safetyScore >= 90 && out.length === 0) out.push({ icon: Sparkles, tone: 'text-success', text: 'Top-tier safety rating — consider as a peer mentor for new drivers.' })
    if (out.length === 0) out.push({ icon: CheckCircle2, tone: 'text-success', text: 'No coaching actions needed for this period.' })
    return out.slice(0, 5)
  }, [eventTypes, me, fleet, blockers, driver.safetyScore])

  const fuelDelta = me.fuelL100 !== null && me.fuelExpectedL100 ? pctChange(me.fuelL100, me.fuelExpectedL100) : null
  const compare: { label: string; mine: string; fleet: string; pct: number | null; goodWhen?: 'up' | 'down' }[] = [
    { label: 'Safety score', mine: String(driver.safetyScore), fleet: fleetAvgScore.toFixed(1), pct: pctChange(driver.safetyScore, fleetAvgScore) },
    { label: 'Trips completed', mine: String(me.trips), fleet: fleetTripsPerDriver.toFixed(1), pct: pctChange(me.trips, fleetTripsPerDriver) },
    { label: 'On-time rate', mine: me.onTimePct === null ? '—' : `${me.onTimePct}%`, fleet: fleet.onTimePct === null ? '—' : `${fleet.onTimePct}%`, pct: me.onTimePct !== null && fleet.onTimePct ? pctChange(me.onTimePct, fleet.onTimePct) : null },
    { label: 'Events / 1,000 km', mine: me.eventsPer1000 === null ? '—' : String(me.eventsPer1000), fleet: fleet.eventsPer1000 === null ? '—' : String(fleet.eventsPer1000), pct: me.eventsPer1000 !== null && fleet.eventsPer1000 ? pctChange(me.eventsPer1000, fleet.eventsPer1000) : null, goodWhen: 'down' },
    { label: 'Fuel (L/100 km)', mine: me.fuelL100 === null ? '—' : String(me.fuelL100), fleet: me.fuelExpectedL100 === null ? '—' : String(me.fuelExpectedL100), pct: fuelDelta, goodWhen: 'down' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Period: <span className="font-medium text-foreground">{range.label}</span> · change it from the top bar. Compared with the previous {range.days}-day period.</p>
        <Segmented<'auto' | Granularity> size="xs" aria-label="Chart granularity" value={gran} onChange={setGran} options={[{ value: 'auto', label: `Auto (${g})` }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Safety score" value={driver.safetyScore} icon={Gauge} status={driver.safetyScore >= 85 ? 'success' : driver.safetyScore >= 70 ? 'warning' : 'danger'} delta={{ pct: pctChange(driver.safetyScore, fleetAvgScore), label: 'vs fleet avg' }} hint="Current rating (0–100)" />
        <KpiCard label="Trips completed" value={me.trips} icon={RouteIcon} delta={{ pct: pctChange(me.trips, prev.trips) }} spark={series.map((s) => s.trips)} />
        <KpiCard label="On-time rate" value={me.onTimePct ?? 0} unit="%" icon={Clock} status={me.onTimePct !== null && me.onTimePct < 80 ? 'warning' : 'success'} delta={prev.onTimePct !== null && me.onTimePct !== null ? { pct: pctChange(me.onTimePct, prev.onTimePct) } : undefined} hint="Completed within 15 min of plan" />
        <KpiCard label="Distance" value={me.km} unit="km" format={(n) => fmtNumber(Math.round(n))} delta={{ pct: pctChange(me.km, prev.km) }} spark={series.map((s) => s.km)} />
        <KpiCard label="Events / 1,000 km" value={me.eventsPer1000 ?? 0} format={(n) => n.toFixed(1)} icon={ShieldAlert} status={me.eventsPer1000 !== null && fleet.eventsPer1000 !== null && me.eventsPer1000 > fleet.eventsPer1000 ? 'warning' : 'success'} delta={prev.eventsPer1000 !== null && me.eventsPer1000 !== null ? { pct: pctChange(me.eventsPer1000, prev.eventsPer1000), goodWhen: 'down' } : undefined} hint={`${me.events} events (${me.highEvents} high severity)`} />
        <KpiCard label="Fuel L/100 km" value={me.fuelL100 ?? '—'} format={(n) => n.toFixed(1)} icon={Fuel} delta={fuelDelta !== null ? { pct: fuelDelta, goodWhen: 'down', label: 'vs fleet avg' } : undefined} hint="Fuel-linked trips vs fleet average for the same vehicle categories" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Safety score trend" description="Estimated from the trailing 28-day telematics event rate, anchored on the current rating">
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={250}
            series={[
              { key: 'score', label: driver.name, type: 'area', color: 'var(--chart-1)' },
              { key: 'fleet', label: 'Fleet average', type: 'line', dashed: true, color: 'var(--chart-7)' },
            ]}
          />
        </ChartCard>
        <ChartCard title="Performance profile" description="Driver vs fleet average (0–100)">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="70%">
                <PolarGrid stroke="var(--chart-grid)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Fleet average" dataKey="fleet" stroke="var(--chart-7)" fill="var(--chart-7)" fillOpacity={0.12} strokeDasharray="4 4" />
                <Radar name={driver.name} dataKey="driver" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.3} strokeWidth={2} />
                <RTooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex justify-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-[3px]" style={{ background: 'var(--chart-1)' }} />Driver</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-[3px]" style={{ background: 'var(--chart-7)' }} />Fleet average</span>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Trips and on-time rate" description={`Completed trips per ${g}`}>
          <TimeSeriesChart
            data={series}
            titleKey="title"
            height={220}
            series={[
              { key: 'trips', label: 'Trips', type: 'bar', color: 'var(--chart-2)' },
              { key: 'onTimePct', label: 'On-time %', type: 'line', axis: 'right', color: 'var(--chart-1)', format: (v) => `${Math.round(v)}%` },
            ]}
            y2Format={(v) => `${v}%`}
          />
        </ChartCard>
        <ChartCard title="Events per 1,000 km" description="Telematics risk events relative to distance driven">
          <TimeSeriesChart
            data={series}
            titleKey="title"
            height={220}
            series={[
              { key: 'events', label: 'Events', type: 'bar', axis: 'right', color: 'var(--chart-3)' },
              { key: 'eventsPer1000', label: 'Driver rate', type: 'line', color: 'var(--chart-6)' },
              { key: 'fleetEventsPer1000', label: 'Fleet rate', type: 'line', dashed: true, color: 'var(--chart-7)' },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Fuel efficiency vs fleet" description="Litres per 100 km on fuel-linked trips">
          {me.fuelL100 === null || me.fuelExpectedL100 === null ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No fuel-linked trips in this period.</p>
          ) : (
            <>
              <BarList
                format={(v) => `${v.toFixed(1)} L`}
                items={[
                  { label: driver.name, value: me.fuelL100, color: me.fuelL100 <= me.fuelExpectedL100 ? 'var(--success)' : 'var(--warning)' },
                  { label: 'Fleet average (same vehicle types)', value: me.fuelExpectedL100, color: 'var(--chart-7)' },
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {fuelDelta !== null && Math.abs(fuelDelta) < 1 ? 'In line with the fleet average' : fuelDelta !== null && fuelDelta < 0 ? `${Math.abs(fuelDelta).toFixed(1)}% more efficient than the fleet average` : `${(fuelDelta ?? 0).toFixed(1)}% above the fleet average`} · {fmtNumber(me.fuelLitres)} L fuelled.
              </p>
            </>
          )}
        </Panel>
        <Panel title="Driver vs fleet" description="Same period" bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-subtle-foreground">
                <th className="px-3.5 py-2 font-medium">Metric</th>
                <th className="px-2 py-2 text-right font-medium">Driver</th>
                <th className="px-2 py-2 text-right font-medium">Fleet</th>
                <th className="px-3.5 py-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((r) => (
                <tr key={r.label} className="border-b border-border/70 last:border-0">
                  <td className="px-3.5 py-2">{r.label}</td>
                  <td className="num px-2 py-2 text-right font-medium">{r.mine}</td>
                  <td className="num px-2 py-2 text-right text-muted-foreground">{r.fleet}</td>
                  <td className="px-3.5 py-2 text-right">{r.pct === null ? '—' : <DeltaChip delta={{ pct: r.pct, goodWhen: r.goodWhen }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Coaching recommendations" description="Generated from this period's data" actions={<Link to="?tab=safety" className="text-xs text-primary hover:underline">Safety records</Link>}>
          <ul className="space-y-2.5">
            {recs.map((r) => (
              <li key={r.text} className="flex items-start gap-2 text-[13px] leading-snug">
                <r.icon className={`mt-0.5 size-4 shrink-0 ${r.tone}`} />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          {eventTypes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
              {eventTypes.slice(0, 4).map(([t, n]) => (
                <span key={t} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted-foreground">{SAFETY_EVENT_TYPE[t as keyof typeof SAFETY_EVENT_TYPE]} · {n}</span>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
