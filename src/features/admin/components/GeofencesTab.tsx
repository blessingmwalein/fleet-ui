import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { z } from 'zod'
import { BellRing, Crosshair, Pencil, Plus, Shapes, Trash2 } from 'lucide-react'
import { actionsColumn, DataTable } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, NumberField, SelectField, SwitchField, TextField } from '@/components/forms/fields'
import { Badge } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Skeleton, Switch } from '@/components/ui/form-controls'
import { EntityLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { Panel } from '@/components/shared/Page'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { useBranchOptions } from '@/hooks/useOptions'
import { cn } from '@/lib/utils'
import type { Geofence, GeofenceKind } from '@/types'
import { useAdminCaps } from './AdminBits'
import { KIND_COLOR } from './GeofenceMap'
import { LocationPicker } from './LocationPicker'

const GeofenceMap = React.lazy(() => import('./GeofenceMap'))

const KIND_LABEL: Record<GeofenceKind, string> = { depot: 'Depot / yard', customer: 'Customer site', restricted: 'Restricted zone', border: 'Border post', city: 'City / service area' }
const KINDS = Object.keys(KIND_LABEL) as GeofenceKind[]
const kindOptions = KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))
const radiusLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`)

interface FenceRow extends Geofence {
  kindLabel: string
  branchName: string
  areaKm2: number
  alerts: string
}

export function GeofencesTab() {
  const geofences = useDb((s) => s.geofences)
  const branches = useDb((s) => s.branches)
  const caps = useAdminCaps()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<{ open: boolean; fence: Geofence | null }>({ open: false, fence: null })
  const mapRef = React.useRef<HTMLDivElement>(null)

  const rows = React.useMemo<FenceRow[]>(
    () =>
      geofences.map((g) => ({
        ...g,
        kindLabel: KIND_LABEL[g.kind],
        branchName: branches.find((b) => b.id === g.branchId)?.name ?? '',
        areaKm2: Math.round((Math.PI * g.radiusM * g.radiusM) / 1e4) / 100,
        alerts: [g.alertOnEnter && 'Entry', g.alertOnExit && 'Exit'].filter(Boolean).join(' + ') || 'None',
      })),
    [geofences, branches],
  )
  const counts = KINDS.map((k) => [k, geofences.filter((g) => g.kind === k).length] as const)
  const alerting = geofences.filter((g) => g.alertOnEnter || g.alertOnExit).length

  const locate = (g: Geofence) => {
    setSelectedId(g.id)
    mapRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const setAlert = (g: Geofence, key: 'alertOnEnter' | 'alertOnExit', value: boolean) => {
    useDb.getState().update('geofences', g.id, { [key]: value }, { summary: `${value ? 'Enabled' : 'Disabled'} ${key === 'alertOnEnter' ? 'entry' : 'exit'} alerts for geofence ${g.name}` })
    toast.success(`${key === 'alertOnEnter' ? 'Entry' : 'Exit'} alerts ${value ? 'on' : 'off'} for ${g.name}`)
  }
  const remove = async (g: Geofence) => {
    if (!(await confirm({ title: `Delete geofence “${g.name}”?`, description: 'Vehicles will no longer trigger entry or exit alerts for this zone.', confirmLabel: 'Delete geofence', destructive: true }))) return
    useDb.getState().remove('geofences', g.id, { summary: `Deleted geofence ${g.name}` })
    if (selectedId === g.id) setSelectedId(null)
    toast.success(`${g.name} deleted`)
  }

  const columns = React.useMemo<ColumnDef<FenceRow, any>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'Geofence',
        size: 280,
        meta: { label: 'Geofence' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[row.original.kind] }} />
            <span className="truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      { id: 'kindLabel', accessorFn: (r) => r.kindLabel, header: 'Kind', size: 140, filterFn: 'inArray', meta: { label: 'Kind' }, cell: ({ row }) => <Badge tone={row.original.kind === 'restricted' ? 'danger' : row.original.kind === 'depot' ? 'info' : row.original.kind === 'customer' ? 'warning' : 'neutral'}>{row.original.kindLabel}</Badge> },
      { id: 'branchName', accessorFn: (r) => r.branchName, header: 'Branch', size: 190, meta: { label: 'Branch', hideBelow: 'lg' }, cell: ({ row }) => (row.original.branchId ? <EntityLink type="branch" id={row.original.branchId} /> : <span className="text-subtle-foreground">—</span>) },
      { id: 'centre', accessorFn: (r) => `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`, header: 'Centre (lat, lng)', size: 170, meta: { label: 'Centre', hideBelow: 'md' }, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.lat.toFixed(4)}, {row.original.lng.toFixed(4)}</span> },
      { id: 'radiusM', accessorFn: (r) => r.radiusM, header: 'Radius', size: 90, meta: { label: 'Radius', align: 'right', exportValue: (r) => r.radiusM }, cell: ({ row }) => radiusLabel(row.original.radiusM) },
      { id: 'areaKm2', accessorFn: (r) => r.areaKm2, header: 'Area (km²)', size: 100, meta: { label: 'Area (km²)', align: 'right', hideBelow: 'xl' } },
      {
        id: 'alertOnEnter',
        accessorFn: (r) => (r.alertOnEnter ? 'On' : 'Off'),
        header: 'Entry alert',
        size: 100,
        filterFn: 'inArray',
        meta: { label: 'Entry alert', align: 'center' },
        cell: ({ row }) => <Switch aria-label={`Entry alert for ${row.original.name}`} disabled={!caps.edit} checked={row.original.alertOnEnter} onCheckedChange={(v) => setAlert(row.original, 'alertOnEnter', v)} onClick={(e) => e.stopPropagation()} />,
      },
      {
        id: 'alertOnExit',
        accessorFn: (r) => (r.alertOnExit ? 'On' : 'Off'),
        header: 'Exit alert',
        size: 100,
        meta: { label: 'Exit alert', align: 'center' },
        cell: ({ row }) => <Switch aria-label={`Exit alert for ${row.original.name}`} disabled={!caps.edit} checked={row.original.alertOnExit} onCheckedChange={(v) => setAlert(row.original, 'alertOnExit', v)} onClick={(e) => e.stopPropagation()} />,
      },
      actionsColumn<FenceRow>((g) => [
        { label: 'Locate on map', icon: <Crosshair />, onClick: () => locate(g) },
        { label: 'Edit geofence', icon: <Pencil />, hidden: !caps.edit, onClick: () => setForm({ open: true, fence: g }) },
        { label: 'Delete geofence', icon: <Trash2 />, destructive: true, hidden: !caps.del, separatorBefore: true, onClick: () => remove(g) },
      ]) as ColumnDef<FenceRow, any>,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps.edit, caps.del],
  )

  const selected = geofences.find((g) => g.id === selectedId)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Geofences" value={geofences.length} icon={Shapes} />
        <KpiCard label="With alerts" value={alerting} icon={BellRing} hint="Raise entry and/or exit notifications" status="success" />
        <KpiCard label="Restricted zones" value={geofences.filter((g) => g.kind === 'restricted').length} icon={Shapes} status="danger" />
        <KpiCard label="Customer sites" value={geofences.filter((g) => g.kind === 'customer').length} icon={Shapes} />
      </div>

      <div ref={mapRef}>
        <Panel
          title="Geofence map"
          description={selected ? `${selected.name} · ${KIND_LABEL[selected.kind]} · ${radiusLabel(selected.radiusM)} radius` : 'Click a zone to select it. The GPS simulator and Live Tracking use these zones for entry/exit alerts.'}
          actions={selected && <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)}>Show all</Button>}
          flush
        >
          <React.Suspense fallback={<Skeleton className="h-[320px] w-full rounded-none" />}>
            <GeofenceMap fences={geofences} selectedId={selectedId} onSelect={setSelectedId} height={320} className="rounded-none border-0" />
          </React.Suspense>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3.5 py-2">
            {counts.map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2.5 rounded-full" style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]} <span className="num text-foreground">{n}</span></span>
            ))}
          </div>
        </Panel>
      </div>

      <DataTable<FenceRow>
        tableId="admin-geofences"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={caps.exportCsv ? 'geofences' : undefined}
        searchPlaceholder="Search geofence, branch…"
        defaultSort={[{ id: 'name', desc: false }]}
        selectable={caps.del}
        bulkActions={
          caps.del
            ? [
                {
                  label: 'Delete',
                  icon: <Trash2 />,
                  destructive: true,
                  onClick: async (sel, clear) => {
                    if (!(await confirm({ title: `Delete ${sel.length} geofence${sel.length === 1 ? '' : 's'}?`, description: 'Entry and exit alerts for these zones stop immediately.', confirmLabel: 'Delete', destructive: true }))) return
                    useDb.getState().removeMany('geofences', sel.map((g) => g.id), { summary: `Deleted ${sel.length} geofences` })
                    toast.success(`${sel.length} geofence${sel.length === 1 ? '' : 's'} deleted`)
                    clear()
                  },
                },
              ]
            : undefined
        }
        facets={[
          { columnId: 'kindLabel', label: 'Kind', options: KINDS.map((k) => ({ value: KIND_LABEL[k], label: KIND_LABEL[k] })) },
          { columnId: 'alertOnEnter', label: 'Entry alert', options: [{ value: 'On', label: 'On' }, { value: 'Off', label: 'Off' }] },
        ]}
        onRowClick={(g) => locate(g)}
        rowClassName={(g) => (g.id === selectedId ? 'bg-primary/8' : undefined)}
        actions={caps.create && <Button size="sm" onClick={() => setForm({ open: true, fence: null })}><Plus /> Add geofence</Button>}
        mobileCard={(g) => (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: KIND_COLOR[g.kind] }} /><span className="truncate text-[13px] font-medium">{g.name}</span></div>
            <div className="text-xs text-muted-foreground">{g.kindLabel} · {radiusLabel(g.radiusM)} · Alerts: {g.alerts}</div>
          </div>
        )}
      />

      <GeofenceFormDialog open={form.open} fence={form.fence} onOpenChange={(o) => !o && setForm((f) => ({ ...f, open: false }))} onSaved={(id) => setSelectedId(id)} />
    </div>
  )
}

const schema = z.object({
  name: z.string().trim().min(3, 'Enter a name (at least 3 characters)').max(80),
  kind: z.enum(['depot', 'customer', 'restricted', 'border', 'city']),
  branchId: z.string().optional(),
  lat: z.number({ error: 'Enter a latitude' }).min(-90, 'Between -90 and 90').max(90, 'Between -90 and 90'),
  lng: z.number({ error: 'Enter a longitude' }).min(-180, 'Between -180 and 180').max(180, 'Between -180 and 180'),
  radiusM: z.number({ error: 'Enter a radius' }).int('Whole metres only').min(50, 'Minimum 50 m').max(50000, 'Maximum 50 km'),
  alertOnEnter: z.boolean(),
  alertOnExit: z.boolean(),
})

function GeofenceFormDialog({ open, fence, onOpenChange, onSaved }: { open: boolean; fence: Geofence | null; onOpenChange: (o: boolean) => void; onSaved: (id: string) => void }) {
  const branchOptions = useBranchOptions()
  const geofences = useDb((s) => s.geofences)
  const defaults = React.useMemo(
    () => (fence ? { name: fence.name, kind: fence.kind, branchId: fence.branchId ?? '', lat: fence.lat, lng: fence.lng, radiusM: fence.radiusM, alertOnEnter: fence.alertOnEnter, alertOnExit: fence.alertOnExit } : { name: '', kind: 'customer' as const, branchId: '', lat: -19.0154, lng: 29.1549, radiusM: 500, alertOnEnter: true, alertOnExit: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fence, open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={fence ? `Edit ${fence.name}` : 'Add geofence'}
      description="Circular zones raise entry/exit alerts when a vehicle crosses the boundary."
      schema={schema}
      defaultValues={defaults}
      size="lg"
      submitLabel={fence ? 'Save changes' : 'Add geofence'}
      onSubmit={(v) => {
        const db = useDb.getState()
        const { branchId, ...rest } = v
        const payload = { ...rest, branchId: branchId || undefined }
        if (fence) {
          db.update('geofences', fence.id, payload, { summary: `Updated geofence ${v.name}` })
          toast.success(`${v.name} updated`)
          onSaved(fence.id)
        } else {
          const created = db.insert('geofences', payload, { summary: `Created ${KIND_LABEL[v.kind].toLowerCase()} geofence ${v.name}` })
          toast.success(`${v.name} added`, { description: `${radiusLabel(v.radiusM)} radius · alerts ${v.alertOnEnter || v.alertOnExit ? 'enabled' : 'off'}` })
          onSaved(created.id)
        }
      }}
    >
      {(form) => (
        <>
          <FormGrid>
            <TextField form={form} name="name" label="Name" required className="sm:col-span-2" placeholder="e.g. Chitungwiza Fuel Depot" />
            <SelectField form={form} name="kind" label="Kind" required options={kindOptions} />
            <SelectField form={form} name="branchId" label="Linked branch" allowEmpty emptyLabel="None" options={branchOptions.map((b) => ({ value: b.value, label: b.label }))} />
            <NumberField form={form} name="lat" label="Centre latitude" required step={0.00001} />
            <NumberField form={form} name="lng" label="Centre longitude" required step={0.00001} />
            <NumberField form={form} name="radiusM" label="Radius" required suffix="m" min={50} max={50000} step={10} className="sm:col-span-2" />
          </FormGrid>
          <LocationPicker form={form} radiusName="radiusM" context={geofences.filter((g) => g.id !== fence?.id)} height={230} />
          <div className={cn('grid gap-3 sm:grid-cols-2')}>
            <SwitchField form={form} name="alertOnEnter" label="Alert on entry" hint="Notify when a vehicle enters" />
            <SwitchField form={form} name="alertOnExit" label="Alert on exit" hint="Notify when a vehicle leaves" />
          </div>
        </>
      )}
    </FormDialog>
  )
}
