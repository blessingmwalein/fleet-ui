import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRightLeft, FilePlus2, Gauge, IdCard, MapPin, MoreHorizontal, Pencil, Phone, Plus, Route as RouteIcon, ShieldAlert, Trash2, Unlink, UserCog, UserX } from 'lucide-react'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { Page, Panel } from '@/components/shared/Page'
import { EmptyState } from '@/components/shared/EmptyState'
import { KpiCard } from '@/components/shared/KpiCard'
import { BranchLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { ExpiryBadge, Status } from '@/components/shared/Status'
import { Avatar, Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { expiryState } from '@/config/status'
import { fmtNumber } from '@/lib/format'
import { dispatchBlockers, useDriverRows } from './driverData'
import { ScoreRing } from './DriverParts'
import { useDriverDialogs } from './DriverDialogs'
import { deleteDriversFlow, unassignVehicleFlow } from './driverFlows'
import { ComplianceTab, EmploymentTab, PersonalTab } from './tabs/ProfileTabs'
import { TripsTab, VehiclesTab } from './tabs/ActivityTabs'
import { PerformanceTab } from './tabs/PerformanceTab'
import { DocumentsTab, IncidentsTab, SafetyTab } from './tabs/RecordsTabs'

const TABS = ['personal', 'employment', 'compliance', 'vehicles', 'trips', 'performance', 'safety', 'incidents', 'documents'] as const
type TabKey = (typeof TABS)[number]

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="num rounded bg-surface-3 px-1 text-[10px] text-muted-foreground">{n}</span> : null
}

export default function DriverDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rows = useDriverRows()
  const row = useMemo(() => rows.find((r) => r.id === id), [rows, id])
  const events = useDb((s) => s.safetyEvents)
  const incidents = useDb((s) => s.incidents)
  const documents = useDb((s) => s.documents)
  const canEdit = useCan('drivers.edit')
  const canDelete = useCan('drivers.delete')
  const canIncident = useCan('safety.create')
  const dlg = useDriverDialogs()

  const counts = useMemo(
    () => ({
      safety: events.filter((e) => e.driverId === id).length,
      incidents: incidents.filter((i) => i.driverId === id).length,
      documents: documents.filter((d) => d.entityType === 'driver' && d.entityId === id).length,
    }),
    [events, incidents, documents, id],
  )

  if (!row) {
    return (
      <Page>
        <Panel>
          <EmptyState icon={UserX} title="Driver not found" description="This driver may have been deleted, or the link is incorrect." action={<Button asChild size="sm"><Link to="/drivers"><ArrowLeft /> Back to drivers</Link></Button>} />
        </Panel>
      </Page>
    )
  }

  const tabParam = params.get('tab') as TabKey | null
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : 'personal'
  const setTab = (t: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (t === 'personal') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  const issues = dispatchBlockers(row)
  const lic = expiryState(row.licenceExpiry, 30)
  const tabProps = { driver: row, row, dlg, canEdit }

  return (
    <Page>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2"><Link to="/drivers"><ArrowLeft /> All drivers</Link></Button>
      </div>

      <section className="panel mb-3 p-4">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <Avatar name={row.name} size={64} />
          <div className="min-w-0 flex-1 basis-72">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight tracking-tight">{row.name}</h1>
              <Status kind="driver" value={row.status} />
              {row.activeTripId && (
                <Badge tone="success" className="gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-success" />On trip · <TripLink id={row.activeTripId} /></Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><IdCard className="size-3.5" />{row.empNo}</span>
              <span className="inline-flex items-center gap-1">Licence <span className="font-mono">{row.licenceNo}</span> · {row.licenceClass}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /><BranchLink id={row.branchId} /></span>
              <span className="inline-flex items-center gap-1">Vehicle {row.vehicleId ? <VehicleLink id={row.vehicleId} /> : <span className="text-subtle-foreground">unassigned</span>}</span>
              <a href={`tel:${row.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="size-3.5" />{row.phone}</a>
            </div>
            {issues.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {issues.map((i) => (
                  <button key={i.label} type="button" onClick={() => setTab('compliance')} className="focus-visible:outline-none">
                    <Badge tone={i.severity === 'block' ? 'danger' : 'warning'} className="gap-1"><ShieldAlert />{i.label}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
          <ScoreRing score={row.safetyScore} size={76} stroke={7} />
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && <Button variant="outline" onClick={() => dlg.openEdit(row.id)}><Pencil /> Edit</Button>}
            {canEdit && <Button variant="outline" onClick={() => dlg.openAssign(row.id)}><ArrowRightLeft /> {row.vehicleId ? 'Change vehicle' : 'Assign vehicle'}</Button>}
            {canEdit && <Button onClick={() => dlg.openStatus([row.id])}><UserCog /> Change status</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {canEdit && <DropdownMenuItem onSelect={() => dlg.openDocument(row.id)}><FilePlus2 /> Upload document</DropdownMenuItem>}
                {row.vehicleId && <DropdownMenuItem onSelect={() => navigate(`/tracking?vehicle=${row.vehicleId}`)}><MapPin /> Track vehicle on map</DropdownMenuItem>}
                {canIncident && <DropdownMenuItem onSelect={() => navigate('/safety/incidents?new=1')}><Plus /> Report incident</DropdownMenuItem>}
                {canEdit && row.vehicleId && <DropdownMenuItem onSelect={() => void unassignVehicleFlow(row)}><Unlink /> Unassign vehicle</DropdownMenuItem>}
                {canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                  <DropdownMenuItem destructive onSelect={async () => { const r = await deleteDriversFlow([row]); if (r?.done.length) navigate('/drivers') }}>
                    <Trash2 /> Delete driver
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Trips completed" value={row.tripsCompleted} icon={RouteIcon} hint="Lifetime completed trips" />
        <KpiCard label="Distance driven" value={row.distanceKm} unit="km" format={(n) => fmtNumber(Math.round(n))} hint="Completed trips, lifetime" />
        <KpiCard label="On-time rate" value={row.onTimePct ?? 0} unit="%" status={row.onTimePct !== null && row.onTimePct < 80 ? 'warning' : 'success'} hint="Completed within 15 min of plan" />
        <KpiCard label="Events / 1,000 km" value={row.eventsPer1000 ?? 0} format={(n) => n.toFixed(1)} icon={Gauge} status={row.eventsPer1000 !== null && row.eventsPer1000 > 4 ? 'warning' : 'success'} hint={`${row.eventCount} telematics events recorded`} />
        <KpiCard label="Licence" value={lic.state === 'expired' ? 'Expired' : `${lic.days}d left`} status={lic.state === 'expired' ? 'danger' : lic.state === 'expiring' ? 'warning' : 'success'} hint={<span className="flex items-center gap-1.5">Expires <ExpiryBadge iso={row.licenceExpiry} /></span>} onClick={() => setTab('compliance')} />
        <KpiCard label="Vehicle" value={row.vehicleReg || 'Unassigned'} status={row.vehicleId ? 'success' : 'neutral'} hint="Click to manage assignment" onClick={() => setTab('vehicles')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="personal">Personal info</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="compliance">Licence &amp; compliance {issues.some((i) => i.severity === 'block') && <span className="size-1.5 rounded-full bg-danger" />}</TabsTrigger>
          <TabsTrigger value="vehicles">Assigned vehicles</TabsTrigger>
          <TabsTrigger value="trips">Trip history <Count n={row.tripsCompleted} /></TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="safety">Safety records <Count n={counts.safety} /></TabsTrigger>
          <TabsTrigger value="incidents">Incidents <Count n={counts.incidents} /></TabsTrigger>
          <TabsTrigger value="documents">Documents <Count n={counts.documents} /></TabsTrigger>
        </TabsList>
        <TabsContent value="personal" className="mt-3"><PersonalTab {...tabProps} /></TabsContent>
        <TabsContent value="employment" className="mt-3"><EmploymentTab {...tabProps} /></TabsContent>
        <TabsContent value="compliance" className="mt-3"><ComplianceTab {...tabProps} /></TabsContent>
        <TabsContent value="vehicles" className="mt-3"><VehiclesTab driver={row} dlg={dlg} canEdit={canEdit} /></TabsContent>
        <TabsContent value="trips" className="mt-3"><TripsTab driver={row} /></TabsContent>
        <TabsContent value="performance" className="mt-3"><PerformanceTab driver={row} /></TabsContent>
        <TabsContent value="safety" className="mt-3"><SafetyTab driver={row} row={row} /></TabsContent>
        <TabsContent value="incidents" className="mt-3"><IncidentsTab driver={row} /></TabsContent>
        <TabsContent value="documents" className="mt-3"><DocumentsTab driver={row} dlg={dlg} canEdit={canEdit} /></TabsContent>
      </Tabs>
      {dlg.node}
    </Page>
  )
}
