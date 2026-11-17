import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, CalendarClock, ClipboardList, Download, FileWarning, Gauge, GraduationCap, ShieldAlert, ShieldCheck, TriangleAlert, Truck, UserRound } from 'lucide-react'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { Status, Plate } from '@/components/shared/Status'
import { DriverLink, VehicleLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge, StatusDot, Avatar } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { ChartCard, BarList, DonutChart, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useBranchScope } from '@/hooks/useFilters'
import { useById } from '@/hooks/useLookup'
import { INCIDENT_TYPE, SAFETY_EVENT_TYPE } from '@/config/status'
import { autoGranularity, makeBuckets, sumByBucket, type Granularity } from '@/lib/analytics'
import { downloadObjectsCsv } from '@/lib/csv'
import { fmtNumber, fmtDate, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { CoachingDialog } from './CoachingDialog'
import { EventTypeChip, IncidentTypeChip, LiveEventFeed, RiskHeatmap, ScoreBar, ViewAllLink } from './SafetyBits'
import { EVENT_COLOR, EVENT_TYPES, HARSH_TYPES, INCIDENT_SEVERITY_COLOR, INCIDENT_SEVERITY_ORDER, INCIDENT_TYPE_KEYS, hotspots, riskBand, type DriverRisk } from './safety'
import { summarise, useDocRows } from './compliance'
import { useNow, useSafetyData } from './useSafetyData'
import { ExpiryBadge } from '@/components/shared/Status'

export default function SafetyOverviewPage() {
  const d = useSafetyData()
  const { rows: docRows, warnDays } = useDocRows()
  const summary = useMemo(() => summarise(docRows, d.vehicles), [docRows, d.vehicles])
  const { branch } = useBranchScope()
  const canCreate = useCan('safety.create')
  const canExport = useCan('safety.export')
  const { range } = d

  const [gran, setGran] = useState<'auto' | Granularity>('auto')
  const g: Granularity = gran === 'auto' ? autoGranularity(range.days) : gran
  const buckets = useMemo(() => makeBuckets(range.from, range.to, g), [range, g])

  const trendRows = useMemo(() => {
    const per = EVENT_TYPES.map((t) => sumByBucket(d.events.filter((e) => e.type === t), buckets, (e) => e.timestamp))
    return buckets.map((b, i) => ({ label: b.label, title: b.title, ...Object.fromEntries(EVENT_TYPES.map((t, k) => [t, per[k]![i]])) }))
  }, [d.events, buckets])
  const trendSeries: Series[] = EVENT_TYPES.map((t) => ({ key: t, label: SAFETY_EVENT_TYPE[t], color: EVENT_COLOR[t], type: 'bar', stack: 'a', hidden: t === 'idling' }))

  const incidentRows = useMemo(
    () =>
      INCIDENT_TYPE_KEYS.map((t) => {
        const of = d.incidents.filter((i) => i.type === t)
        return { label: INCIDENT_TYPE[t], total: of.length, ...Object.fromEntries(INCIDENT_SEVERITY_ORDER.map((s) => [s, of.filter((i) => i.severity === s).length])) }
      })
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total),
    [d.incidents],
  )
  const incidentSeries: Series[] = INCIDENT_SEVERITY_ORDER.map((s) => ({ key: s, label: s[0]!.toUpperCase() + s.slice(1), color: INCIDENT_SEVERITY_COLOR[s], type: 'bar', stack: 's' }))

  // KPI sparklines
  const incSpark = useMemo(() => sumByBucket(d.incidents, buckets, (i) => i.date), [d.incidents, buckets])
  const speedSpark = useMemo(() => sumByBucket(d.events.filter((e) => e.type === 'speeding'), buckets, (e) => e.timestamp), [d.events, buckets])
  const harshSpark = useMemo(() => sumByBucket(d.events.filter((e) => HARSH_TYPES.has(e.type)), buckets, (e) => e.timestamp), [d.events, buckets])

  const speeding = d.events.filter((e) => e.type === 'speeding').length
  const prevSpeeding = d.prevEvents.filter((e) => e.type === 'speeding').length
  const harshRate = d.km ? (d.harshCount / d.km) * 1000 : 0
  const prevHarshRate = d.prevKm ? (d.prevHarshCount / d.prevKm) * 1000 : 0
  const band = riskBand(d.riskIndex)
  const openIncidents = d.scopedIncidents.filter((i) => i.status === 'reported' || i.status === 'investigating')

  const [heatMode, setHeatMode] = useState<'time' | 'places'>('time')
  const places = useMemo(() => hotspots([...d.events, ...d.incidents], 8), [d.events, d.incidents])

  const [coachTargets, setCoachTargets] = useState<DriverRisk[]>([])
  const [coachOpen, setCoachOpen] = useState(false)
  const coach = (r: DriverRisk) => { setCoachTargets([r]); setCoachOpen(true) }

  const league = useMemo(() => d.driverRisk.filter((r) => r.km > 0 || r.events > 0).sort((a, b) => a.score - b.score), [d.driverRisk])
  const coachingCount = league.filter((r) => r.coaching).length

  const donut = [
    { name: 'Valid', value: summary.valid, color: 'var(--success)' },
    { name: `Expiring ≤${warnDays}d`, value: summary.expiring, color: 'var(--warning)' },
    { name: 'Expired', value: summary.expired, color: 'var(--danger)' },
  ]

  const exportLeague = () => {
    downloadObjectsCsv(`driver-risk-${new Date().toISOString().slice(0, 10)}`, league, {
      Driver: (r) => r.name, 'Employee no': (r) => r.driver.empNo, Score: (r) => r.score, 'Distance (km)': (r) => Math.round(r.km), Events: (r) => r.events, Incidents: (r) => r.incidents,
      'Risk points / 1,000 km': (r) => Number(r.per1000.toFixed(2)), 'Main issue': (r) => (r.topType ? SAFETY_EVENT_TYPE[r.topType] : ''), 'Coaching suggested': (r) => (r.coaching ? 'Yes' : 'No'),
    })
    toast.success(`Exported ${league.length} driver risk rows`)
  }

  return (
    <Page>
      <PageHeader
        title="Safety & compliance"
        description={`Risk, driver behaviour and compliance across ${branch ? branch.name : 'the whole fleet'} · ${range.label.toLowerCase()}`}
        meta={<Badge tone="success" className="gap-1.5"><StatusDot tone="success" pulse className="size-1.5 [&>span]:size-1.5" />Live</Badge>}
        actions={
          <>
            {canExport && <Button variant="outline" size="sm" onClick={exportLeague}><Download /> Export driver risk</Button>}
            <Button variant="outline" size="sm" asChild><Link to="/safety/compliance"><ShieldCheck /> Compliance</Link></Button>
            {canCreate && <Button size="sm" asChild><Link to="/safety/incidents?new=1"><TriangleAlert /> Report incident</Link></Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Incidents" icon={ShieldAlert} value={d.incidents.length} spark={incSpark} sparkColor="var(--chart-6)" delta={{ pct: pctChange(d.incidents.length, d.prevIncidents.length), goodWhen: 'down' }}
          href="/safety/incidents" status={openIncidents.length ? 'warning' : undefined} hint={`${openIncidents.length} open (reported or investigating) across the whole register`}
        />
        <KpiCard
          label="Risk score" icon={Gauge} value={d.riskIndex} unit="/ 100" status={band.tone} delta={{ pct: pctChange(d.riskIndex, d.prevRiskIndex), goodWhen: 'down' }}
          hint={<span>Severity-weighted events and incidents per 1,000 km, scaled 0–100 (lower is better). Band: <b>{band.label}</b>. Previous period: {d.prevRiskIndex}.</span>}
        />
        <KpiCard
          label="Harsh events / 1,000 km" icon={Activity} value={harshRate} format={(n) => n.toFixed(1)} spark={harshSpark} sparkColor="var(--chart-2)" delta={{ pct: pctChange(harshRate, prevHarshRate), goodWhen: 'down' }}
          hint={`${fmtNumber(d.harshCount)} harsh braking / acceleration / cornering events over ${fmtNumber(d.km)} km`}
        />
        <KpiCard label="Speeding events" icon={Truck} value={speeding} spark={speedSpark} sparkColor="var(--chart-3)" delta={{ pct: pctChange(speeding, prevSpeeding), goodWhen: 'down' }} href="/safety/behaviour?tab=speeding" />
        <KpiCard
          label="Expiring documents" icon={CalendarClock} value={summary.expiring} unit={`≤ ${warnDays}d`} status={summary.expired ? 'danger' : summary.expiring ? 'warning' : 'success'} href="/safety/compliance"
          hint={`${summary.expired} already expired · ${summary.expiring} expiring within ${warnDays} days`}
        />
        <KpiCard
          label="Non-compliant fleet" icon={FileWarning} value={summary.nonCompliantVehicles.length} unit={`of ${d.vehicles.length} veh.`} status={summary.nonCompliantVehicles.length ? 'danger' : 'success'} href="/safety/compliance"
          hint="Vehicles with an expired or missing core document (insurance, roadworthiness, licence)"
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <ChartCard
          title="Safety events by type" description={`${fmtNumber(d.events.length)} events · ${range.label.toLowerCase()}`} className="xl:col-span-2"
          actions={<Segmented size="xs" aria-label="Granularity" value={gran} onChange={setGran} options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}
        >
          <TimeSeriesChart data={trendRows} series={trendSeries} titleKey="title" height={250} stacked />
        </ChartCard>
        <Panel title="Live safety feed" description="Newest events from vehicles on the road" actions={<><span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success"><StatusDot tone="success" pulse />Live</span><ViewAllLink to="/safety/behaviour">View all</ViewAllLink></>} flush>
          <LiveEventFeed limit={7} />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Incidents by type & severity" description={`${d.incidents.length} incident${d.incidents.length === 1 ? '' : 's'} · ${range.label.toLowerCase()}`}>
          <TimeSeriesChart data={incidentRows} series={incidentSeries} height={250} stacked empty="No incidents in this period" />
        </ChartCard>
        <ChartCard
          title={heatMode === 'time' ? 'Risk by day & time' : 'Risk hotspots'} description={heatMode === 'time' ? 'Severity-weighted events & incidents' : 'Events and incidents by corridor / town'}
          actions={<Segmented size="xs" aria-label="Heat-map view" value={heatMode} onChange={setHeatMode} options={[{ value: 'time', label: 'Time' }, { value: 'places', label: 'Places' }]} />}
        >
          {heatMode === 'time' ? <RiskHeatmap events={d.events} incidents={d.incidents} /> : <BarList items={places.map(([label, value]) => ({ label, value, color: 'var(--chart-6)' }))} format={(v) => `${v} events`} emptyText="No located events in this period" />}
        </ChartCard>
        <ChartCard title="Compliance status" description={`${summary.total} documents · vehicles & drivers`} actions={<ViewAllLink to="/safety/compliance">Open register</ViewAllLink>}>
          <DonutChart data={donut} height={160} centerValue={`${Math.round(summary.rate)}%`} centerLabel="Not expired" />
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
            <div><div className="label-xs">Vehicles fully compliant</div><div className="num mt-0.5 text-sm font-semibold">{Math.round(summary.compliantVehiclePct)}%</div></div>
            <div><div className="label-xs">Drivers with lapsed docs</div><div className={cn('num mt-0.5 text-sm font-semibold', summary.driversLapsed && 'text-danger')}>{summary.driversLapsed}</div></div>
          </div>
        </ChartCard>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel
          title="Driver risk league" description={`${league.length} drivers scored · ${coachingCount} flagged for coaching`} className="xl:col-span-2" flush
          actions={<ViewAllLink to="/safety/behaviour?tab=scorecards">All scorecards</ViewAllLink>}
        >
          <LeagueTable rows={league} onCoach={coach} />
        </Panel>
        <div className="flex flex-col gap-3">
          <OpenIncidents />
          <ExpiringSoon rows={docRows.filter((r) => r.state !== 'valid').sort((a, b) => a.days - b.days).slice(0, 5)} />
        </div>
      </div>

      <CoachingDialog open={coachOpen} onOpenChange={setCoachOpen} targets={coachTargets} />
    </Page>
  )
}

function LeagueTable({ rows, onCoach }: { rows: DriverRisk[]; onCoach: (r: DriverRisk) => void }) {
  const canEdit = useCan('safety.edit')
  const navigate = useNavigate()
  const columns = useMemo<ColumnDef<DriverRisk, any>[]>(
    () => [
      { id: 'driver', accessorFn: (r) => r.name, header: 'Driver', size: 190, cell: ({ row }) => <span className="flex items-center gap-2"><Avatar name={row.original.name} size={22} /><DriverLink id={row.original.id} /></span> },
      { id: 'score', accessorFn: (r) => r.score, header: 'Score', size: 130, cell: ({ row }) => <ScoreBar score={row.original.score} /> },
      { id: 'events', accessorFn: (r) => r.events, header: 'Events', size: 70, meta: { align: 'right' } },
      { id: 'incidents', accessorFn: (r) => r.incidents, header: 'Incidents', size: 80, meta: { align: 'right', hideBelow: 'md' } },
      { id: 'per1000', accessorFn: (r) => Number(r.per1000.toFixed(1)), header: 'Pts / 1,000 km', size: 110, meta: { align: 'right', hideBelow: 'lg' } },
      { id: 'issue', accessorFn: (r) => (r.topType ? SAFETY_EVENT_TYPE[r.topType] : '—'), header: 'Main issue', size: 160, meta: { hideBelow: 'md' }, cell: ({ row }) => (row.original.topType ? <span className="flex items-center gap-1.5"><EventTypeChip type={row.original.topType} /><span className="num text-xs text-muted-foreground">×{row.original.topCount}</span></span> : <span className="text-subtle-foreground">—</span>) },
      {
        id: 'coaching', accessorFn: (r) => (r.coaching ? 'Coaching suggested' : 'On track'), header: 'Coaching', size: 150,
        cell: ({ row }) => row.original.coaching
          ? <Badge tone="danger" className="gap-1"><GraduationCap />Suggested</Badge>
          : <Badge tone="success">On track</Badge>,
      },
      actionsColumn<DriverRisk>((r) => [
        { label: 'Coach driver', icon: <GraduationCap />, onClick: () => onCoach(r), hidden: !canEdit },
        { label: 'View profile', icon: <UserRound />, onClick: () => navigate(`/drivers/${r.id}`) },
      ]),
    ],
    [canEdit, navigate, onCoach],
  )
  return (
    <DataTable<DriverRisk>
      data={rows} columns={columns} tableId="safety-league" getRowId={(r) => r.id} bare defaultPageSize={8} pageSizes={[8, 16, 50]} defaultSort={[{ id: 'score', desc: false }]}
      onRowClick={(r) => navigate(`/drivers/${r.id}`)} emptyTitle="No driver activity in this period"
    />
  )
}

function OpenIncidents() {
  const incidents = useDb((s) => s.incidents)
  const { scope } = useBranchScope()
  const getVehicle = useById('vehicles')
  const rows = useMemo(() => scope(incidents).filter((i) => i.status === 'reported' || i.status === 'investigating').sort((a, b) => b.date.localeCompare(a.date)), [incidents, scope])
  const now = useNow(30_000)
  void now
  return (
    <Panel title="Open incidents" description={`${rows.length} awaiting resolution`} actions={<ViewAllLink to="/safety/incidents">Register</ViewAllLink>} flush>
      {rows.length === 0 ? (
        <EmptyState compact title="No open incidents" description="Everything reported has been resolved." icon={ClipboardList} />
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.slice(0, 5).map((i) => (
            <li key={i.id}>
              <Link to={`/safety/incidents?open=${i.id}`} className="flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-accent/40">
                <IncidentTypeChip type={i.type} label="" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium"><span className="num">{i.ref}</span><span className="truncate text-muted-foreground">{INCIDENT_TYPE[i.type]}</span></p>
                  <p className="truncate text-xs text-muted-foreground"><Plate>{getVehicle(i.vehicleId)?.reg ?? '—'}</Plate> · {timeAgo(i.date)}</p>
                </div>
                <Status kind="severity" value={i.severity} dot={false} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ExpiringSoon({ rows }: { rows: ReturnType<typeof useDocRows>['rows'] }) {
  const navigate = useNavigate()
  return (
    <Panel title="Needs renewal" description="Soonest expiries first" actions={<ViewAllLink to="/safety/compliance">Compliance</ViewAllLink>} flush>
      {rows.length === 0 ? (
        <EmptyState compact title="Nothing expiring" description="All documents are valid." icon={ShieldCheck} />
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((r) => (
            <li key={r.id} role="button" tabIndex={0} className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-accent/40" onClick={() => navigate(`/safety/compliance?open=${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/safety/compliance?open=${r.id}`)}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{r.typeLabel}</p>
                <p className="truncate text-xs text-muted-foreground">{r.kind === 'Vehicle' ? <VehicleLink id={r.entityId} /> : r.entityName} · {fmtDate(r.expiryDate)}</p>
              </div>
              <ExpiryBadge iso={r.expiryDate} warnDays={30} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
