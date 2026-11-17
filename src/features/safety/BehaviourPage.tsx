import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, Bell, Check, CheckCheck, Eye, EyeOff, GraduationCap, Map as MapIcon, Moon, Route, Search, Timer, Truck, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { SafetyEvent } from '@/types'
import { Page, PageHeader, Panel, DetailGrid } from '@/components/shared/Page'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { Status, Plate } from '@/components/shared/Status'
import { BranchLink, DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import { Input } from '@/components/ui/form-controls'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { BarList, ChartCard, Sparkline, TimeSeriesChart, type Series } from '@/components/charts/charts'
import { DataTable, actionsColumn, type BulkAction, type RowAction } from '@/components/data-table/DataTable'
import { MiniMap, type MiniMapMarker } from '@/components/map/MiniMap'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { useCan } from '@/hooks/useAuth'
import { useById, useOpenParam } from '@/hooks/useLookup'
import { SAFETY_EVENT_TYPE } from '@/config/status'
import { fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CoachingDialog } from './CoachingDialog'
import { EventIcon, EventSeverity, EventTypeChip, ScoreBar, ScoreRing, eventDetail } from './SafetyBits'
import { COACHING_BELOW, EVENT_COLOR, EVENT_TYPES, HARSH_TYPES, hotspots, scoreTone, toneVar, type DriverRisk } from './safety'
import { useNow, useSafetyData } from './useSafetyData'

interface EvRow extends SafetyEvent {
  typeLabel: string
  severityLabel: string
  vehicleReg: string
  driverName: string
  branchName: string
  reviewLabel: string
  detail: string
}

function markReviewed(ids: string[], reviewed: boolean) {
  if (!ids.length) return
  useDb.getState().updateMany('safetyEvents', ids, { reviewed }, { summary: `${reviewed ? 'Reviewed' : 'Reopened for review'} ${ids.length} safety event${ids.length === 1 ? '' : 's'}` })
  toast.success(reviewed ? `${ids.length} event${ids.length === 1 ? '' : 's'} marked as reviewed` : `${ids.length} event${ids.length === 1 ? '' : 's'} reopened for review`)
}

export default function BehaviourPage() {
  const d = useSafetyData()
  const { range } = d
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'events'
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const canEdit = useCan('safety.edit')
  const [coachTargets, setCoachTargets] = useState<DriverRisk[]>([])
  const [coachOpen, setCoachOpen] = useState(false)
  const coach = (r: DriverRisk[]) => { if (!r.length) return toast.error('No drivers to coach for the selection'); setCoachTargets(r); setCoachOpen(true) }

  const scored = useMemo(() => d.driverRisk.filter((r) => r.km > 0 || r.events > 0), [d.driverRisk])
  const riskById = useMemo(() => new Map(d.driverRisk.map((r) => [r.id, r])), [d.driverRisk])
  const avgScore = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0
  const toCoach = scored.filter((r) => r.coaching)
  const unreviewed = d.events.filter((e) => !e.reviewed).length
  const harshRate = d.km ? (d.harshCount / d.km) * 1000 : 0
  const prevHarshRate = d.prevKm ? (d.prevHarshCount / d.prevKm) * 1000 : 0
  const fatigue = d.events.filter((e) => e.type === 'fatigue')
  const speeding = d.events.filter((e) => e.type === 'speeding')

  return (
    <Page>
      <PageHeader title="Driver behaviour" description={`Telematics events, driver scorecards, fatigue and speeding analysis · ${range.label.toLowerCase()}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Events" icon={Activity} value={d.events.length} delta={{ pct: pctChange(d.events.length, d.prevEvents.length), goodWhen: 'down' }} />
        <KpiCard label="Awaiting review" icon={Eye} value={unreviewed} status={unreviewed ? 'warning' : 'success'} onClick={() => setTab('events')} />
        <KpiCard label="Harsh events / 1,000 km" icon={Truck} value={harshRate} format={(n) => n.toFixed(1)} delta={{ pct: pctChange(harshRate, prevHarshRate), goodWhen: 'down' }} />
        <KpiCard label="Average driver score" icon={Users} value={avgScore} format={(n) => n.toFixed(0)} unit="/ 100" status={scored.length ? scoreTone(avgScore) : undefined} onClick={() => setTab('scorecards')} />
        <KpiCard label="Coaching recommended" icon={GraduationCap} value={toCoach.length} unit="drivers" status={toCoach.length ? 'danger' : 'success'} hint={`Drivers scoring below ${COACHING_BELOW}`} onClick={() => setTab('scorecards')} />
        <KpiCard label="Fatigue alerts" icon={Moon} value={fatigue.length} status={fatigue.length ? 'warning' : undefined} onClick={() => setTab('fatigue')} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="events">Events <Badge className="ml-0.5">{d.events.length}</Badge></TabsTrigger>
          <TabsTrigger value="scorecards">Driver scorecards <Badge className="ml-0.5">{scored.length}</Badge></TabsTrigger>
          <TabsTrigger value="fatigue">Fatigue <Badge tone={fatigue.length ? 'warning' : 'neutral'} className="ml-0.5">{fatigue.length}</Badge></TabsTrigger>
          <TabsTrigger value="speeding">Speeding <Badge className="ml-0.5">{speeding.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="pt-3"><EventsTab events={d.events} riskById={riskById} onCoach={coach} canEdit={canEdit} /></TabsContent>
        <TabsContent value="scorecards" className="pt-3"><ScorecardsTab rows={scored} onCoach={coach} canEdit={canEdit} /></TabsContent>
        <TabsContent value="fatigue" className="pt-3"><FatigueTab events={fatigue} drivers={d.driverRisk} /></TabsContent>
        <TabsContent value="speeding" className="pt-3"><SpeedingTab events={speeding} /></TabsContent>
      </Tabs>
      <CoachingDialog open={coachOpen} onOpenChange={setCoachOpen} targets={coachTargets} />
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function EventsTab({ events, riskById, onCoach, canEdit }: { events: SafetyEvent[]; riskById: Map<string, DriverRisk>; onCoach: (r: DriverRisk[]) => void; canEdit: boolean }) {
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const branches = useDb((s) => s.branches)
  const [view, setView] = useState<'all' | 'pending'>('all')
  const [openId, setOpenId] = useOpenParam()
  const getEvent = useById('safetyEvents')
  const openTrip = useUi((s) => s.openTrip)

  const rows = useMemo<EvRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    const dById = new Map(drivers.map((x) => [x.id, x]))
    const bById = new Map(branches.map((b) => [b.id, b]))
    return events
      .filter((e) => view === 'all' || !e.reviewed)
      .map((e) => ({
        ...e,
        typeLabel: SAFETY_EVENT_TYPE[e.type],
        severityLabel: e.severity[0]!.toUpperCase() + e.severity.slice(1),
        vehicleReg: vById.get(e.vehicleId)?.reg ?? '—',
        driverName: (e.driverId && dById.get(e.driverId)?.name) || 'Unassigned',
        branchName: bById.get(e.branchId)?.name ?? '—',
        reviewLabel: e.reviewed ? 'Reviewed' : 'Pending',
        detail: eventDetail(e),
      }))
  }, [events, vehicles, drivers, branches, view])

  const coachFor = (sel: EvRow[]) => onCoach([...new Set(sel.map((r) => r.driverId).filter(Boolean) as string[])].map((id) => riskById.get(id)).filter(Boolean) as DriverRisk[])
  const rowActions = (r: EvRow): RowAction[] => [
    { label: 'Open details', icon: <Search />, onClick: () => setOpenId(r.id) },
    { label: r.reviewed ? 'Reopen for review' : 'Mark reviewed', icon: r.reviewed ? <EyeOff /> : <Check />, onClick: () => markReviewed([r.id], !r.reviewed), hidden: !canEdit },
    { label: 'Coach driver', icon: <GraduationCap />, onClick: () => coachFor([r]), hidden: !canEdit || !r.driverId },
    { label: 'View trip', icon: <Route />, onClick: () => r.tripId && openTrip(r.tripId), hidden: !r.tripId, separatorBefore: true },
  ]

  const columns = useMemo<ColumnDef<EvRow, any>[]>(
    () => [
      { id: 'time', accessorFn: (r) => r.timestamp, header: 'Time', size: 140, meta: { label: 'Time', exportValue: (r) => fmtDateTime(r.timestamp) }, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.timestamp)}</span> },
      { id: 'type', accessorFn: (r) => r.typeLabel, header: 'Event', size: 160, filterFn: 'inArray', cell: ({ row }) => <EventTypeChip type={row.original.type} /> },
      { id: 'severity', accessorFn: (r) => r.severityLabel, header: 'Severity', size: 90, filterFn: 'inArray', sortingFn: (a, b) => ['low', 'medium', 'high'].indexOf(a.original.severity) - ['low', 'medium', 'high'].indexOf(b.original.severity), cell: ({ row }) => <EventSeverity severity={row.original.severity} /> },
      { id: 'vehicle', accessorFn: (r) => r.vehicleReg, header: 'Vehicle', size: 110, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 150, cell: ({ row }) => <DriverLink id={row.original.driverId} fallback="Unassigned" /> },
      { id: 'detail', accessorFn: (r) => r.detail, header: 'Measurement', size: 230, meta: { hideBelow: 'md' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.detail}</span> },
      { id: 'location', accessorFn: (r) => r.location, header: 'Location', size: 220, meta: { hideBelow: 'xl' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.location}</span> },
      { id: 'review', accessorFn: (r) => r.reviewLabel, header: 'Review', size: 100, cell: ({ row }) => (row.original.reviewed ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Pending</Badge>) },
      { id: 'branch', accessorFn: (r) => r.branchName, header: 'Branch', size: 130, filterFn: 'inArray', meta: { hideBelow: 'xl' } },
      actionsColumn<EvRow>(rowActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, setOpenId, openTrip, riskById],
  )

  const bulk: BulkAction<EvRow>[] = canEdit
    ? [
        { label: 'Mark reviewed', icon: <CheckCheck />, onClick: (s, clear) => { markReviewed(s.filter((r) => !r.reviewed).map((r) => r.id), true); clear() } },
        { label: 'Reopen', icon: <EyeOff />, onClick: (s, clear) => { markReviewed(s.filter((r) => r.reviewed).map((r) => r.id), false); clear() } },
        { label: 'Coach drivers', icon: <GraduationCap />, onClick: (s, clear) => { coachFor(s); clear() } },
      ]
    : []

  const facets = [
    { columnId: 'type', label: 'Event type', options: EVENT_TYPES.map((t) => ({ value: SAFETY_EVENT_TYPE[t], label: SAFETY_EVENT_TYPE[t] })) },
    { columnId: 'severity', label: 'Severity', options: ['Low', 'Medium', 'High'].map((v) => ({ value: v, label: v })) },
    { columnId: 'branch', label: 'Branch', options: [...new Set(rows.map((r) => r.branchName))].sort().map((v) => ({ value: v, label: v })) },
  ]
  const event = openId ? getEvent(openId) : undefined
  useEffect(() => { if (openId && !event) setOpenId(null) }, [openId, event, setOpenId])

  return (
    <>
      <DataTable<EvRow>
        data={rows} columns={columns} tableId="safety-events" getRowId={(r) => r.id} searchPlaceholder="Search vehicle, driver, location…" facets={facets} exportName="safety-events"
        selectable bulkActions={bulk} defaultSort={[{ id: 'time', desc: true }]} defaultHidden={['branch']} onRowClick={(r) => setOpenId(r.id)}
        toolbar={<Segmented size="sm" aria-label="Review filter" value={view} onChange={setView} options={[{ value: 'all', label: 'All events' }, { value: 'pending', label: 'Needs review' }]} />}
        emptyTitle="No safety events" emptyDescription="Nothing recorded for this period, branch or filter."
        rowClassName={(r) => (r.reviewed ? undefined : 'bg-warning/[0.04]')}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><EventTypeChip type={r.type} /><EventSeverity severity={r.severity} /></div>
            <p className="text-xs text-muted-foreground"><Plate>{r.vehicleReg}</Plate> · {r.driverName} · {timeAgo(r.timestamp)}</p>
            <p className="truncate text-xs text-subtle-foreground">{r.detail} · {r.location}</p>
          </div>
        )}
      />
      <EventDrawer event={event} onClose={() => setOpenId(null)} onCoach={(e) => coachFor([{ driverId: e.driverId } as EvRow])} canEdit={canEdit} />
    </>
  )
}

function EventDrawer({ event, onClose, onCoach, canEdit }: { event: SafetyEvent | undefined; onClose: () => void; onCoach: (e: SafetyEvent) => void; canEdit: boolean }) {
  const openTrip = useUi((s) => s.openTrip)
  const markers = useMemo<MiniMapMarker[]>(() => (event ? [{ id: event.id, lat: event.lat, lng: event.lng, kind: 'incident', label: SAFETY_EVENT_TYPE[event.type] }] : []), [event?.id, event?.lat, event?.lng, event?.type]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        {event && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2"><EventIcon type={event.type} />{SAFETY_EVENT_TYPE[event.type]}<EventSeverity severity={event.severity} />{event.reviewed ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Pending review</Badge>}</SheetTitle>
              <SheetDescription>{fmtDateTime(event.timestamp)} · {timeAgo(event.timestamp)}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <p className="rounded-md border border-border bg-surface-2/50 p-3 text-[13px]">{eventDetail(event)}</p>
              <DetailGrid
                items={[
                  { label: 'Vehicle', value: <VehicleLink id={event.vehicleId} /> },
                  { label: 'Driver', value: <DriverLink id={event.driverId} avatar fallback="Unassigned" /> },
                  { label: 'Trip', value: event.tripId ? <TripLink id={event.tripId} /> : '—' },
                  { label: 'Branch', value: <BranchLink id={event.branchId} /> },
                  { label: 'Speed', value: `${event.speedKph} km/h` },
                  { label: 'Limit', value: event.limitKph ? `${event.limitKph} km/h` : '—' },
                  { label: 'Reading', value: event.value !== undefined ? (event.type === 'fatigue' ? `${event.value.toFixed(1)} h` : `${event.value.toFixed(2)} g`) : '—' },
                  { label: 'Location', value: event.location },
                ]}
              />
              <MiniMap height={200} markers={markers} zoom={12} />
            </SheetBody>
            <SheetFooter>
              {event.tripId && <Button variant="outline" onClick={() => { openTrip(event.tripId); onClose() }}><Route /> View trip</Button>}
              {canEdit && event.driverId && <Button variant="outline" onClick={() => { onCoach(event); onClose() }}><GraduationCap /> Coach driver</Button>}
              {canEdit && <Button onClick={() => markReviewed([event.id], !event.reviewed)}>{event.reviewed ? <><EyeOff /> Reopen</> : <><Check /> Mark reviewed</>}</Button>}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------
type SortKey = 'risk' | 'best' | 'events' | 'name'

function ScorecardsTab({ rows, onCoach, canEdit }: { rows: DriverRisk[]; onCoach: (r: DriverRisk[]) => void; canEdit: boolean }) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [only, setOnly] = useState<'all' | 'coach'>('all')
  const [sort, setSort] = useState<SortKey>('risk')
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const vehicles = useDb((s) => s.vehicles)
  const branches = useDb((s) => s.branches)
  const vById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const bById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches])

  const shown = useMemo(() => {
    const s = rows.filter((r) => (only === 'all' || r.coaching) && (!q || r.name.toLowerCase().includes(q.toLowerCase())))
    const cmp: Record<SortKey, (a: DriverRisk, b: DriverRisk) => number> = { risk: (a, b) => a.score - b.score, best: (a, b) => b.score - a.score, events: (a, b) => b.events - a.events, name: (a, b) => a.name.localeCompare(b.name) }
    return s.slice().sort(cmp[sort])
  }, [rows, only, q, sort])

  const columns = useMemo<ColumnDef<DriverRisk, any>[]>(
    () => [
      { id: 'driver', accessorFn: (r) => r.name, header: 'Driver', size: 190, cell: ({ row }) => <span className="flex items-center gap-2"><Avatar name={row.original.name} size={22} /><DriverLink id={row.original.id} /></span> },
      { id: 'vehicle', accessorFn: (r) => vById.get(r.driver.vehicleId ?? '')?.reg ?? '—', header: 'Vehicle', size: 110, cell: ({ row }) => <VehicleLink id={row.original.driver.vehicleId} /> },
      { id: 'score', accessorFn: (r) => r.score, header: 'Score', size: 130, cell: ({ row }) => <ScoreBar score={row.original.score} /> },
      { id: 'events', accessorFn: (r) => r.events, header: 'Events', size: 80, meta: { align: 'right' } },
      { id: 'harsh', accessorFn: (r) => r.harsh, header: 'Harsh', size: 70, meta: { align: 'right' } },
      { id: 'speeding', accessorFn: (r) => r.speeding, header: 'Speeding', size: 85, meta: { align: 'right' } },
      { id: 'incidents', accessorFn: (r) => r.incidents, header: 'Incidents', size: 85, meta: { align: 'right' } },
      { id: 'km', accessorFn: (r) => Math.round(r.km), header: 'Distance (km)', size: 110, meta: { align: 'right' } },
      { id: 'per1000', accessorFn: (r) => Number(r.per1000.toFixed(1)), header: 'Pts / 1,000 km', size: 115, meta: { align: 'right' } },
      { id: 'issue', accessorFn: (r) => (r.topType ? SAFETY_EVENT_TYPE[r.topType] : '—'), header: 'Top issue', size: 160, cell: ({ row }) => (row.original.topType ? <EventTypeChip type={row.original.topType} /> : <span className="text-subtle-foreground">—</span>) },
      { id: 'coaching', accessorFn: (r) => (r.coaching ? 'Coaching suggested' : 'On track'), header: 'Coaching', size: 130, cell: ({ row }) => (row.original.coaching ? <Badge tone="danger">Suggested</Badge> : <Badge tone="success">On track</Badge>) },
      { id: 'coached', accessorFn: (r) => (r.lastCoached ? fmtDateTime(r.lastCoached) : 'Never'), header: 'Last coached', size: 140, meta: { hideBelow: 'xl' } },
      actionsColumn<DriverRisk>((r) => [
        { label: 'Coach driver', icon: <GraduationCap />, onClick: () => onCoach([r]), hidden: !canEdit },
        { label: 'View profile', icon: <UserRound />, onClick: () => navigate(`/drivers/${r.id}`) },
      ]),
    ],
    [vById, canEdit, onCoach, navigate],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drivers…" className="pl-8" aria-label="Search drivers" />
        </div>
        <Segmented size="sm" aria-label="Filter" value={only} onChange={setOnly} options={[{ value: 'all', label: `All (${rows.length})` }, { value: 'coach', label: `Needs coaching (${rows.filter((r) => r.coaching).length})` }]} />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Sort drivers"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="risk">Highest risk first</SelectItem>
            <SelectItem value="best">Best score first</SelectItem>
            <SelectItem value="events">Most events</SelectItem>
            <SelectItem value="name">Name A–Z</SelectItem>
          </SelectContent>
        </Select>
        <Segmented size="sm" className="ml-auto" aria-label="View" value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
        {canEdit && only === 'coach' && shown.length > 1 && <Button size="sm" onClick={() => onCoach(shown)}><GraduationCap /> Coach all ({shown.length})</Button>}
      </div>
      {view === 'cards' ? (
        shown.length === 0 ? (
          <Panel><EmptyState compact title="No drivers match" description="Adjust the search or filter." icon={Users} /></Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shown.map((r) => <ScoreCard key={r.id} r={r} vehicle={vById.get(r.driver.vehicleId ?? '')?.reg} branch={bById.get(r.driver.branchId)?.name} onCoach={() => onCoach([r])} canEdit={canEdit} />)}
          </div>
        )
      ) : (
        <DataTable<DriverRisk> data={shown} columns={columns} tableId="safety-scorecards" getRowId={(r) => r.id} exportName="driver-scorecards" selectable bulkActions={canEdit ? [{ label: 'Coach drivers', icon: <GraduationCap />, onClick: (s, clear) => { onCoach(s); clear() } }] : []} defaultSort={[{ id: 'score', desc: false }]} defaultHidden={['harsh', 'speeding', 'per1000']} onRowClick={(r) => navigate(`/drivers/${r.id}`)} searchPlaceholder="Search drivers…" bare={false} />
      )}
    </div>
  )
}

function ScoreCard({ r, vehicle, branch, onCoach, canEdit }: { r: DriverRisk; vehicle?: string; branch?: string; onCoach: () => void; canEdit: boolean }) {
  const navigate = useNavigate()
  const tone = scoreTone(r.score)
  const first = r.trend[0] ?? r.score
  const delta = r.score - first
  return (
    <div className={cn('panel flex flex-col gap-3 p-3.5', r.coaching && 'border-danger/30')}>
      <div className="flex items-start gap-3">
        <Avatar name={r.name} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold"><DriverLink id={r.id} /></p>
          <p className="truncate text-xs text-muted-foreground">{vehicle ? <Plate>{vehicle}</Plate> : 'No vehicle'}{branch ? ` · ${branch}` : ''}</p>
          <p className="mt-0.5 text-[11px] text-subtle-foreground">{r.driver.empNo} · {r.driver.licenceClass}</p>
        </div>
        <ScoreRing score={r.score} size={54} />
      </div>
      <div>
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-subtle-foreground">
          <span>Score trend</span>
          {r.trend.length > 2 && <span className={cn('num font-medium', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted-foreground')}>{delta > 0 ? '+' : ''}{delta} pts</span>}
        </div>
        {r.trend.length > 2 ? <Sparkline data={r.trend} color={toneVar[tone]} height={34} /> : <div className="h-[34px]" />}
      </div>
      <div className="grid grid-cols-4 gap-1 rounded-md bg-surface-2/60 py-2 text-center">
        {[['Events', r.events], ['/1,000 km', r.per1000.toFixed(1)], ['Incidents', r.incidents], ['km', fmtNumber(r.km)]].map(([l, v]) => (
          <div key={l as string}><div className="num text-[13px] font-semibold">{v}</div><div className="text-[10px] text-subtle-foreground">{l}</div></div>
        ))}
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        {r.topType ? <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-xs"><EventIcon type={r.topType} size="sm" />{SAFETY_EVENT_TYPE[r.topType]}<span className="num text-muted-foreground">×{r.topCount}</span></span> : <span className="text-xs text-subtle-foreground">No events in period</span>}
        {r.coaching ? <Badge tone="danger" className="gap-1"><GraduationCap />Coaching suggested</Badge> : <Badge tone="success">On track</Badge>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-[11px] text-subtle-foreground">{r.lastCoached ? `Coached ${timeAgo(r.lastCoached)}` : 'Never coached'}</span>
        <div className="flex gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => navigate(`/drivers/${r.id}`)}><UserRound /> Profile</Button>
          {canEdit && <Button size="xs" variant={r.coaching ? 'default' : 'outline'} onClick={onCoach}><GraduationCap /> Coach</Button>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fatigue
// ---------------------------------------------------------------------------
const BREAK_DUE_H = 4.5

function FatigueTab({ events, drivers }: { events: SafetyEvent[]; drivers: DriverRisk[] }) {
  const trips = useDb((s) => s.trips)
  const vehicles = useDb((s) => s.vehicles)
  const telemetry = useLive((s) => s.telemetry)
  const maxH = useSettings((s) => s.thresholds.maxDriveHours)
  const canEdit = useCan('safety.edit')
  const now = useNow(30_000)
  const dById = useMemo(() => new Map(drivers.map((r) => [r.id, r])), [drivers])
  const vById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])

  const live = useMemo(
    () =>
      trips
        .filter((t) => (t.status === 'in_transit' || t.status === 'delayed') && t.driverId && t.vehicleId && t.actualStart)
        .map((t) => {
          const hours = Math.max(0, (now - new Date(t.actualStart!).getTime()) / 36e5)
          return { trip: t, driver: dById.get(t.driverId!), vehicle: vById.get(t.vehicleId!), hours: Math.min(hours, 14), state: telemetry[t.vehicleId!]?.state }
        })
        .filter((r) => r.driver && r.vehicle)
        .sort((a, b) => b.hours - a.hours),
    [trips, now, dById, vById, telemetry],
  )
  const offenders = useMemo(() => drivers.filter((r) => r.fatigue > 0).sort((a, b) => b.fatigue - a.fatigue).slice(0, 8), [drivers])

  const alertDriver = (name: string, id: string, hours: number) => {
    useDb.getState().update('drivers', id, {}, { action: 'system', summary: `Rest-break alert sent to ${name} after ${hours.toFixed(1)} h continuous driving` })
    toast.success(`Rest alert sent to ${name}`, { description: `${hours.toFixed(1)} h continuous driving — pull over at the next safe stop.` })
  }

  const columns = useMemo<ColumnDef<SafetyEvent & { driverName: string; vehicleReg: string }, any>[]>(
    () => [
      { id: 'time', accessorFn: (r) => r.timestamp, header: 'Time', size: 140, meta: { label: 'Time', exportValue: (r) => fmtDateTime(r.timestamp) }, cell: ({ row }) => <span className="num text-muted-foreground">{fmtDateTime(row.original.timestamp)}</span> },
      { id: 'driver', accessorFn: (r) => r.driverName, header: 'Driver', size: 160, cell: ({ row }) => <DriverLink id={row.original.driverId} fallback="Unassigned" /> },
      { id: 'vehicle', accessorFn: (r) => r.vehicleReg, header: 'Vehicle', size: 110, cell: ({ row }) => <VehicleLink id={row.original.vehicleId} /> },
      { id: 'hours', accessorFn: (r) => r.value ?? 0, header: 'Hours driving', size: 120, meta: { align: 'right' }, cell: ({ row }) => <span className={cn('num font-medium', (row.original.value ?? 0) >= 6 ? 'text-danger' : 'text-warning')}>{row.original.value?.toFixed(1)} h</span> },
      { id: 'location', accessorFn: (r) => r.location, header: 'Location', size: 220, meta: { hideBelow: 'md' } },
      { id: 'review', accessorFn: (r) => (r.reviewed ? 'Reviewed' : 'Pending'), header: 'Review', size: 100, cell: ({ row }) => (row.original.reviewed ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Pending</Badge>) },
      actionsColumn<SafetyEvent & { driverName: string; vehicleReg: string }>((r) => [{ label: r.reviewed ? 'Reopen for review' : 'Mark reviewed', icon: r.reviewed ? <EyeOff /> : <Check />, onClick: () => markReviewed([r.id], !r.reviewed), hidden: !canEdit }]),
    ],
    [canEdit],
  )
  const fRows = useMemo(() => events.map((e) => ({ ...e, driverName: dById.get(e.driverId ?? '')?.name ?? 'Unassigned', vehicleReg: vById.get(e.vehicleId)?.reg ?? '—' })), [events, dById, vById])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Continuous driving — live" description={`Time since trip start · break due at ${BREAK_DUE_H} h, limit ${maxH} h`} className="xl:col-span-2" flush>
          {live.length === 0 ? (
            <EmptyState compact icon={Moon} title="No vehicles on the road" description="Active trips and their driving hours appear here." />
          ) : (
            <ul className="max-h-[22rem] divide-y divide-border/70 overflow-y-auto">
              {live.slice(0, 12).map(({ trip, driver, vehicle, hours, state }) => {
                const tone = hours >= maxH ? 'danger' : hours >= BREAK_DUE_H ? 'warning' : 'success'
                return (
                  <li key={trip.id} className="flex items-center gap-3 px-3.5 py-2">
                    <Avatar name={driver!.name} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2"><DriverLink id={driver!.id} /><span className="text-muted-foreground">·</span><VehicleLink id={vehicle!.id} />{state && <Status kind="live" value={state} />}</span>
                        <span className="num font-semibold" style={{ color: toneVar[tone] }}>{hours.toFixed(1)} h</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, (hours / maxH) * 100)}%`, background: toneVar[tone] }} /></div>
                    </div>
                    {hours >= BREAK_DUE_H ? (
                      <Button size="xs" variant={tone === 'danger' ? 'destructive' : 'outline'} disabled={!canEdit} onClick={() => alertDriver(driver!.name, driver!.id, hours)}><Bell /> Rest alert</Button>
                    ) : (
                      <Badge tone="success" className="w-[4.75rem]">Rested</Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <ChartCard title="Repeat fatigue alerts" description="Drivers with the most alerts in range">
          <BarList items={offenders.map((r) => ({ label: r.name, value: r.fatigue, color: EVENT_COLOR.fatigue }))} format={(v) => `${v} alert${v === 1 ? '' : 's'}`} emptyText="No fatigue alerts in this period" />
        </ChartCard>
      </div>
      <DataTable data={fRows} columns={columns} tableId="safety-fatigue" getRowId={(r) => r.id} exportName="fatigue-alerts" defaultSort={[{ id: 'time', desc: true }]} searchPlaceholder="Search driver or vehicle…" defaultPageSize={10} pageSizes={[10, 25, 50]} emptyTitle="No fatigue alerts" emptyDescription="No driver exceeded continuous driving limits in this period." />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speeding
// ---------------------------------------------------------------------------
const OVER_BINS = ['1–5', '6–10', '11–15', '16–20', '21–25', '26–30', '31+']

function SpeedingTab({ events }: { events: SafetyEvent[] }) {
  const getDriver = useById('drivers')
  const navigate = useNavigate()
  const overOf = (e: SafetyEvent) => Math.max(0, e.speedKph - (e.limitKph ?? e.speedKph))
  const stats = useMemo(() => {
    const overs = events.map(overOf)
    const dist = OVER_BINS.map((label) => ({ label, count: 0 }))
    for (const o of overs) dist[Math.min(6, Math.max(0, Math.ceil(o / 5) - 1))]!.count++
    const byHour = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}h`, count: 0 }))
    for (const e of events) byHour[new Date(e.timestamp).getHours()]!.count++
    const byDriver = new Map<string, { n: number; over: number }>()
    for (const e of events) if (e.driverId) { const c = byDriver.get(e.driverId) ?? { n: 0, over: 0 }; c.n++; c.over += overOf(e); byDriver.set(e.driverId, c) }
    return {
      dist, byHour,
      avg: overs.length ? overs.reduce((s, o) => s + o, 0) / overs.length : 0,
      max: Math.max(0, ...events.map((e) => e.speedKph)),
      severe: overs.filter((o) => o > 20).length,
      top: [...byDriver.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8),
    }
  }, [events])
  const places = useMemo(() => hotspots(events, 8), [events])
  const distSeries: Series[] = [{ key: 'count', label: 'Events', color: 'var(--chart-3)', type: 'bar' }]
  const hourSeries: Series[] = [{ key: 'count', label: 'Events', color: 'var(--chart-2)', type: 'bar' }]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Speeding events" icon={Truck} value={events.length} />
        <KpiCard label="Average over limit" icon={Activity} value={stats.avg} format={(n) => `+${n.toFixed(1)}`} unit="km/h" />
        <KpiCard label="Severe (> 20 km/h over)" icon={Timer} value={stats.severe} status={stats.severe ? 'danger' : 'success'} hint={events.length ? `${Math.round((stats.severe / events.length) * 100)}% of speeding events` : undefined} />
        <KpiCard label="Top speed recorded" icon={Activity} value={stats.max} unit="km/h" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Over-limit distribution" description="How far above the limit — km/h over">
          <TimeSeriesChart data={stats.dist} series={distSeries} height={230} legend={false} empty="No speeding events in this period" />
        </ChartCard>
        <ChartCard title="When speeding happens" description="Events by hour of day">
          <TimeSeriesChart data={stats.byHour} series={hourSeries} height={230} legend={false} />
        </ChartCard>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top speeding drivers" description="Events in range · average km/h over limit">
          <BarList
            items={stats.top.map(([id, v]) => ({ label: getDriver(id)?.name ?? id, sub: `avg +${(v.over / v.n).toFixed(0)} km/h`, value: v.n, color: 'var(--chart-3)', onClick: () => navigate(`/drivers/${id}`) }))}
            format={(v) => `${v} events`} emptyText="No speeding events in this period"
          />
        </ChartCard>
        <ChartCard title="Speeding hotspots" description="Corridors and towns with the most events" actions={<MapIcon className="size-4 text-muted-foreground" />}>
          <BarList items={places.map(([label, value]) => ({ label, value, color: 'var(--chart-6)' }))} format={(v) => `${v} events`} emptyText="No located events" />
        </ChartCard>
      </div>
    </div>
  )
}

void HARSH_TYPES
