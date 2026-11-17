import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { toast } from 'sonner'
import { CheckCheck, FilePlus2, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { subDays } from 'date-fns'
import type { DocumentRecord, Driver, SafetyEvent } from '@/types'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Panel } from '@/components/shared/Page'
import { Status, ExpiryBadge } from '@/components/shared/Status'
import { EntityLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { ChartCard, DonutChart, TimeSeriesChart, chartColor } from '@/components/charts/charts'
import { DataTable, actionsColumn } from '@/components/data-table/DataTable'
import { DOCUMENT_TYPE, INCIDENT_TYPE, SAFETY_EVENT_TYPE } from '@/config/status'
import { entityPath } from '@/lib/navigation'
import { makeBuckets, sumByBucket } from '@/lib/analytics'
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DriverRow } from '../driverData'
import type { DriverDialogsApi } from '../DriverDialogs'
import { removeDocumentFlow } from '../driverFlows'

const SEV_TONE = { low: 'neutral', medium: 'warning', high: 'danger' } as const

/* ================================================================================================ Safety records */
interface SafetyRow extends SafetyEvent {
  typeLabel: string
  vehicleReg: string
  reviewedLabel: string
}
const sc = createColumnHelper<SafetyRow>()

export function SafetyTab({ driver, row }: { driver: Driver; row: DriverRow }) {
  const events = useDb((s) => s.safetyEvents)
  const vehicles = useDb((s) => s.vehicles)
  const canReview = useCan('safety.edit')
  const mine = useMemo(() => events.filter((e) => e.driverId === driver.id), [events, driver.id])
  const rows = useMemo<SafetyRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    return mine.map((e) => ({ ...e, typeLabel: SAFETY_EVENT_TYPE[e.type], vehicleReg: vById.get(e.vehicleId)?.reg ?? '', reviewedLabel: e.reviewed ? 'reviewed' : 'pending' }))
  }, [mine, vehicles])

  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of mine) m.set(SAFETY_EVENT_TYPE[e.type], (m.get(SAFETY_EVENT_TYPE[e.type]) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, color: chartColor(i) }))
  }, [mine])

  const weekly = useMemo(() => {
    const buckets = makeBuckets(subDays(new Date(), 118), new Date(), 'week')
    const sev = (s: SafetyEvent['severity']) => sumByBucket(mine.filter((e) => e.severity === s), buckets, (e) => e.timestamp)
    const [low, med, high] = [sev('low'), sev('medium'), sev('high')]
    return buckets.map((b, i) => ({ label: b.label, title: b.title, low: low[i], medium: med[i], high: high[i] }))
  }, [mine])

  const high = mine.filter((e) => e.severity === 'high').length
  const pending = mine.filter((e) => !e.reviewed).length
  const last30 = mine.filter((e) => new Date(e.timestamp).getTime() > Date.now() - 30 * 864e5).length

  const markReviewed = (ids: string[]) => {
    useDb.getState().updateMany('safetyEvents', ids, { reviewed: true }, { summary: `Marked ${ids.length} safety event${ids.length === 1 ? '' : 's'} reviewed for ${driver.name}` })
    toast.success(`${ids.length} event${ids.length === 1 ? '' : 's'} marked as reviewed`)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total events" value={mine.length} hint="All recorded telematics events" />
        <KpiCard label="High severity" value={high} status={high ? 'danger' : 'success'} />
        <KpiCard label="Pending review" value={pending} status={pending ? 'warning' : 'success'} />
        <KpiCard label="Events / 1,000 km" value={row.eventsPer1000 ?? 0} format={(n) => n.toFixed(1)} hint={`${last30} in the last 30 days`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <ChartCard title="Events by type" description="Share of all recorded events">
          {byType.length ? <DonutChart data={byType} height={150} centerLabel="Events" legendCols={1} /> : <p className="py-10 text-center text-xs text-muted-foreground">No safety events recorded.</p>}
        </ChartCard>
        <ChartCard title="Weekly events by severity" description="Last 17 weeks">
          <TimeSeriesChart
            data={weekly}
            titleKey="title"
            height={170}
            stacked
            series={[
              { key: 'low', label: 'Low', type: 'bar', color: 'var(--chart-2)' },
              { key: 'medium', label: 'Medium', type: 'bar', color: 'var(--chart-3)' },
              { key: 'high', label: 'High', type: 'bar', color: 'var(--chart-6)' },
            ]}
          />
        </ChartCard>
      </div>
      <DataTable
        tableId="driver-safety-events"
        data={rows}
        getRowId={(r) => r.id}
        exportName={`driver-${driver.empNo}-safety-events`}
        searchPlaceholder="Search type, location, vehicle…"
        defaultSort={[{ id: 'timestamp', desc: true }]}
        selectable={canReview}
        bulkActions={canReview ? [{ label: 'Mark reviewed', icon: <CheckCheck />, onClick: (sel, clear) => { markReviewed(sel.filter((s) => !s.reviewed).map((s) => s.id)); clear() } }] : []}
        facets={[
          { columnId: 'typeLabel', label: 'Type', options: Object.values(SAFETY_EVENT_TYPE).map((l) => ({ value: l, label: l })) },
          { columnId: 'severity', label: 'Severity', options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
          { columnId: 'reviewedLabel', label: 'Review', options: [{ value: 'pending', label: 'Pending' }, { value: 'reviewed', label: 'Reviewed' }] },
        ]}
        emptyTitle="No safety events"
        emptyDescription="This driver has no recorded harsh-driving or speeding events."
        columns={[
          sc.accessor('timestamp', { header: 'Time', size: 150, meta: { label: 'Time' }, cell: (c) => <span className="num">{fmtDateTime(c.getValue())}</span> }),
          sc.accessor('typeLabel', { header: 'Event', size: 150, filterFn: 'inArray' }),
          sc.accessor('severity', { header: 'Severity', size: 100, filterFn: 'inArray', cell: (c) => <Badge tone={SEV_TONE[c.getValue() as SafetyEvent['severity']]} className="capitalize">{c.getValue()}</Badge> }),
          sc.accessor('vehicleReg', { header: 'Vehicle', size: 110, cell: ({ row: r }) => <VehicleLink id={r.original.vehicleId} /> }),
          sc.accessor('tripId', { header: 'Trip', size: 140, cell: ({ row: r }) => <TripLink id={r.original.tripId} /> }),
          sc.accessor('location', { header: 'Location', size: 260 }),
          sc.accessor('speedKph', {
            header: 'Speed',
            size: 110,
            meta: { align: 'right', exportValue: (r) => r.speedKph },
            cell: ({ row: r }) => (r.original.limitKph ? <span className="text-danger">{r.original.speedKph} / {r.original.limitKph}</span> : `${r.original.speedKph}`),
          }),
          sc.accessor('value', { header: 'Reading', size: 90, meta: { align: 'right' }, cell: ({ row: r }) => (r.original.value === undefined ? '—' : r.original.type === 'fatigue' ? `${r.original.value} h` : `${r.original.value} g`) }),
          sc.accessor('reviewedLabel', { header: 'Review', size: 100, filterFn: 'inArray', cell: (c) => (c.getValue() === 'reviewed' ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Pending</Badge>) }),
          actionsColumn<SafetyRow>((r) => [{ label: 'Mark reviewed', icon: <CheckCheck />, onClick: () => markReviewed([r.id]), hidden: r.reviewed || !canReview }]),
        ]}
      />
    </div>
  )
}

/* ================================================================================================ Incidents */
interface IncidentRow {
  id: string
  ref: string
  date: string
  typeLabel: string
  severity: string
  status: string
  vehicleId: string
  vehicleReg: string
  location: string
  injuries: number
  estCostUsd: number
  claim: string
}
const ic = createColumnHelper<IncidentRow>()

export function IncidentsTab({ driver }: { driver: Driver }) {
  const navigate = useNavigate()
  const money = useMoney()
  const canReport = useCan('safety.create')
  const incidents = useDb((s) => s.incidents)
  const vehicles = useDb((s) => s.vehicles)
  const rows = useMemo<IncidentRow[]>(() => {
    const vById = new Map(vehicles.map((v) => [v.id, v]))
    return incidents
      .filter((i) => i.driverId === driver.id)
      .map((i) => ({ id: i.id, ref: i.ref, date: i.date, typeLabel: INCIDENT_TYPE[i.type], severity: i.severity, status: i.status, vehicleId: i.vehicleId, vehicleReg: vById.get(i.vehicleId)?.reg ?? '', location: i.location, injuries: i.injuries, estCostUsd: i.estCostUsd, claim: i.insuranceClaim ? 'Yes' : 'No' }))
  }, [incidents, vehicles, driver.id])
  const open = rows.filter((r) => r.status === 'reported' || r.status === 'investigating').length
  const cost = rows.reduce((s, r) => s + r.estCostUsd, 0)
  const injuries = rows.reduce((s, r) => s + r.injuries, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Incidents" value={rows.length} status={rows.length ? 'warning' : 'success'} />
          <KpiCard label="Open" value={open} status={open ? 'danger' : 'success'} hint="Reported or under investigation" />
          <KpiCard label="Injuries" value={injuries} status={injuries ? 'danger' : 'success'} />
          <KpiCard label="Estimated cost" value={money(cost, { compact: true })} hint="Sum of estimated incident costs" />
        </div>
        {canReport && (
          <Button asChild variant="outline"><Link to="/safety/incidents?new=1"><Plus /> Report incident</Link></Button>
        )}
      </div>
      <DataTable
        tableId="driver-incidents"
        data={rows}
        getRowId={(r) => r.id}
        exportName={`driver-${driver.empNo}-incidents`}
        searchPlaceholder="Search incidents…"
        defaultSort={[{ id: 'date', desc: true }]}
        onRowClick={(r) => navigate(entityPath('incident', r.id))}
        facets={[
          { columnId: 'typeLabel', label: 'Type', options: Object.values(INCIDENT_TYPE).map((l) => ({ value: l, label: l })) },
          { columnId: 'severity', label: 'Severity', options: ['minor', 'moderate', 'major', 'critical'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
          { columnId: 'status', label: 'Status', options: ['reported', 'investigating', 'resolved', 'closed'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
        ]}
        emptyTitle="No incidents"
        emptyDescription="No incidents are attributed to this driver."
        columns={[
          ic.accessor('ref', { header: 'Incident', size: 130, cell: ({ row: r }) => <EntityLink type="incident" id={r.original.id} /> }),
          ic.accessor('date', { header: 'Date', size: 130, cell: (c) => <span className="num">{fmtDate(c.getValue())}</span> }),
          ic.accessor('typeLabel', { header: 'Type', size: 120, filterFn: 'inArray' }),
          ic.accessor('severity', { header: 'Severity', size: 100, filterFn: 'inArray', cell: (c) => <Status kind="severity" value={c.getValue()} dot={false} /> }),
          ic.accessor('status', { header: 'Status', size: 120, filterFn: 'inArray', cell: (c) => <Status kind="incident" value={c.getValue()} /> }),
          ic.accessor('vehicleReg', { header: 'Vehicle', size: 110, cell: ({ row: r }) => <VehicleLink id={r.original.vehicleId} /> }),
          ic.accessor('location', { header: 'Location', size: 260 }),
          ic.accessor('injuries', { header: 'Injuries', size: 80, meta: { align: 'right' } }),
          ic.accessor('estCostUsd', { header: 'Est. cost', size: 100, meta: { align: 'right' }, cell: (c) => money(c.getValue()) }),
          ic.accessor('claim', { header: 'Claim', size: 70 }),
        ]}
      />
    </div>
  )
}

/* ================================================================================================ Documents */
interface DocRow extends DocumentRecord {
  typeLabel: string
}
const dc = createColumnHelper<DocRow>()

export function DocumentsTab({ driver, dlg, canEdit }: { driver: Driver; dlg: DriverDialogsApi; canEdit: boolean }) {
  const documents = useDb((s) => s.documents)
  const rows = useMemo<DocRow[]>(() => documents.filter((d) => d.entityType === 'driver' && d.entityId === driver.id).map((d) => ({ ...d, typeLabel: DOCUMENT_TYPE[d.type] ?? d.type })), [documents, driver.id])
  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-3 p-3" className="border-dashed">
        <FileText className="size-4 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          {rows.length} document{rows.length === 1 ? '' : 's'} on file · {rows.filter((r) => new Date(r.expiryDate).getTime() < Date.now()).length} expired. Expired and expiring certificates raise alerts and block dispatch.
        </p>
      </Panel>
      <DataTable
        tableId="driver-documents"
        data={rows}
        getRowId={(r) => r.id}
        exportName={`driver-${driver.empNo}-documents`}
        searchPlaceholder="Search documents…"
        defaultSort={[{ id: 'expiryDate', desc: false }]}
        actions={canEdit ? <Button size="sm" onClick={() => dlg.openDocument(driver.id)}><FilePlus2 /> Upload document</Button> : undefined}
        facets={[{ columnId: 'typeLabel', label: 'Type', options: Object.values(DOCUMENT_TYPE).filter((l) => ['Driver licence', 'Defensive driving', 'Medical certificate', 'PrDP'].includes(l)).map((l) => ({ value: l, label: l })) }]}
        emptyTitle="No documents on file"
        emptyDescription="Upload the driver's licence, medical and training certificates."
        columns={[
          dc.accessor('typeLabel', { header: 'Document', size: 190, filterFn: 'inArray', cell: ({ row: r }) => <span className="flex items-center gap-2 font-medium"><FileText className="size-3.5 text-muted-foreground" />{r.original.typeLabel}</span> }),
          dc.accessor('number', { header: 'Number', size: 140, cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
          dc.accessor('issuer', { header: 'Issuer', size: 190 }),
          dc.accessor('issueDate', { header: 'Issued', size: 110, cell: (c) => <span className="num">{fmtDate(c.getValue())}</span> }),
          dc.accessor('expiryDate', { header: 'Expires', size: 190, cell: ({ row: r }) => <span className="flex items-center gap-2"><span className="num w-[5.6rem] shrink-0">{fmtDate(r.original.expiryDate)}</span><ExpiryBadge iso={r.original.expiryDate} /></span> }),
          dc.accessor('fileName', { header: 'File', size: 210, cell: ({ row: r }) => <span className={cn('truncate')}>{r.original.fileName} <span className="text-xs text-subtle-foreground">· {fmtNumber(r.original.fileSizeKb)} KB</span></span> }),
          dc.accessor('uploadedBy', { header: 'Uploaded by', size: 130 }),
          actionsColumn<DocRow>((d) => [
            { label: 'Renew / upload new', icon: <RefreshCw />, onClick: () => dlg.openDocument(driver.id, d.type), hidden: !canEdit },
            { label: 'Delete document', icon: <Trash2 />, destructive: true, separatorBefore: true, onClick: () => void removeDocumentFlow(d), hidden: !canEdit },
          ]),
        ]}
      />
    </div>
  )
}
