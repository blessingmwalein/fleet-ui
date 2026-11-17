import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { z } from 'zod'
import { Ban, Building2, CircleCheck, Eye, Filter, LayoutGrid, Mail, MapPin, Pencil, Phone, Plus, Rows3, Search, Trash2, Truck, UserRound, Users, Warehouse, X } from 'lucide-react'
import { actionsColumn, DataTable, RowActions } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { FormGrid, FormSection, NumberField, SelectField, SwitchField, TextField } from '@/components/forms/fields'
import { Badge, StatusDot } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Input, Progress, Skeleton } from '@/components/ui/form-controls'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { DetailGrid } from '@/components/shared/Page'
import { Plate, Status } from '@/components/shared/Status'
import { BRANCH_TYPE } from '@/config/status'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { Branch } from '@/types'
import { useAdminCaps } from './AdminBits'
import { LocationPicker } from './LocationPicker'

const MiniMap = React.lazy(() => import('@/components/map/MiniMap').then((m) => ({ default: m.MiniMap })))

export interface BranchRow extends Branch {
  vehicles: number
  drivers: number
  users: number
  util: number
}

const typeOptions = Object.entries(BRANCH_TYPE).map(([value, label]) => ({ value, label }))

function useBranchRows(): BranchRow[] {
  const branches = useDb((s) => s.branches)
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const users = useDb((s) => s.users)
  return React.useMemo(
    () =>
      branches.map((b) => {
        const v = vehicles.filter((x) => x.branchId === b.id).length
        return { ...b, vehicles: v, drivers: drivers.filter((x) => x.branchId === b.id).length, users: users.filter((x) => x.branchId === b.id).length, util: b.bayCapacity ? Math.round((v / b.bayCapacity) * 100) : 0 }
      }),
    [branches, vehicles, drivers, users],
  )
}

function useBranchActions() {
  const toggleActive = async (b: BranchRow) => {
    const db = useDb.getState()
    if (b.status === 'active') {
      const ok = await confirm({
        title: `Deactivate ${b.name}?`,
        description: `The branch is marked inactive. ${b.vehicles} vehicle${b.vehicles === 1 ? '' : 's'}, ${b.drivers} driver${b.drivers === 1 ? '' : 's'} and ${b.users} user${b.users === 1 ? '' : 's'} assigned to it are not moved. You can reactivate it any time.`,
        confirmLabel: 'Deactivate',
        destructive: true,
      })
      if (!ok) return
      db.update('branches', b.id, { status: 'inactive' }, { action: 'status', summary: `Deactivated branch ${b.name}` })
      toast.success(`${b.name} deactivated`)
    } else {
      db.update('branches', b.id, { status: 'active' }, { action: 'status', summary: `Reactivated branch ${b.name}` })
      toast.success(`${b.name} reactivated`)
    }
  }
  const remove = async (b: BranchRow): Promise<boolean> => {
    if (b.vehicles + b.drivers + b.users > 0) {
      toast.error(`${b.name} still has assigned records`, { description: `${b.vehicles} vehicles, ${b.drivers} drivers, ${b.users} users. Reassign them first — or deactivate the branch instead.` })
      return false
    }
    const db = useDb.getState()
    const fences = db.geofences.filter((g) => g.branchId === b.id)
    const ok = await confirm({ title: `Delete ${b.name}?`, description: `This permanently removes the branch${fences.length ? ` and its ${fences.length} linked geofence${fences.length === 1 ? '' : 's'}` : ''}.`, confirmLabel: 'Delete branch', destructive: true })
    if (!ok) return false
    if (fences.length) db.removeMany('geofences', fences.map((g) => g.id), { summary: `Deleted ${fences.length} geofence(s) of branch ${b.name}` })
    db.remove('branches', b.id, { summary: `Deleted branch ${b.name} (${b.code})` })
    toast.success(`${b.name} deleted`)
    return true
  }
  return { toggleActive, remove }
}

function capacityTone(util: number) {
  return util > 100 ? 'bg-danger' : util >= 85 ? 'bg-warning' : undefined
}

export function BranchesTab({ highlightId, onClearHighlight }: { highlightId: string | null; onClearHighlight: () => void }) {
  const rows = useBranchRows()
  const caps = useAdminCaps()
  const actions = useBranchActions()
  const [view, setView] = React.useState<'cards' | 'table'>(() => {
    try { return localStorage.getItem('fleetcore.admin.branchView') === 'table' ? 'table' : 'cards' } catch { return 'cards' }
  })
  const setViewPersist = (v: 'cards' | 'table') => {
    setView(v)
    try { localStorage.setItem('fleetcore.admin.branchView', v) } catch { /* ignore */ }
  }
  const [q, setQ] = React.useState('')
  const [type, setType] = React.useState('all')
  const [form, setForm] = React.useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null })
  const [drawerId, setDrawerId] = React.useState<string | null>(null)

  const stats = React.useMemo(() => {
    const cap = rows.reduce((s, b) => s + b.bayCapacity, 0)
    const veh = rows.reduce((s, b) => s + b.vehicles, 0)
    return { active: rows.filter((b) => b.status === 'active').length, total: rows.length, cap, veh, util: cap ? Math.round((veh / cap) * 100) : 0, over: rows.filter((b) => b.util > 100).length }
  }, [rows])

  const filtered = rows.filter((b) => (type === 'all' || b.type === type) && (!q || `${b.name} ${b.code} ${b.city} ${b.manager}`.toLowerCase().includes(q.toLowerCase())))
  const highlighted = rows.find((b) => b.id === highlightId)

  React.useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => document.getElementById(`branch-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
    return () => clearTimeout(t)
  }, [highlightId, view, rows.length])

  const openForm = (branch: Branch | null) => setForm({ open: true, branch })

  const rowActions = (b: BranchRow) => [
    { label: 'View details', icon: <Eye />, onClick: () => setDrawerId(b.id) },
    { label: 'Edit branch', icon: <Pencil />, hidden: !caps.edit, onClick: () => openForm(b) },
    { label: 'Limit app to this branch', icon: <Filter />, onClick: () => { useUi.getState().setBranchId(b.id); toast.success(`Global branch filter set to ${b.name}`) } },
    { label: b.status === 'active' ? 'Deactivate' : 'Reactivate', icon: b.status === 'active' ? <Ban /> : <CircleCheck />, hidden: !caps.edit, separatorBefore: true, onClick: () => actions.toggleActive(b) },
    { label: 'Delete branch', icon: <Trash2 />, destructive: true, hidden: !caps.del, onClick: () => actions.remove(b) },
  ]

  const columns = React.useMemo<ColumnDef<BranchRow, any>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: 'Branch',
        size: 280,
        meta: { label: 'Branch' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-6 min-w-9 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[11px] font-semibold">{row.original.code}</span>
            <span className="truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      { id: 'typeLabel', accessorFn: (r) => BRANCH_TYPE[r.type] ?? r.type, header: 'Type', size: 130, filterFn: 'inArray', meta: { label: 'Type' } },
      { id: 'city', accessorFn: (r) => r.city, header: 'City', size: 110, filterFn: 'inArray', meta: { label: 'City', hideBelow: 'md' } },
      { id: 'manager', accessorFn: (r) => r.manager, header: 'Manager', size: 160, meta: { label: 'Manager', hideBelow: 'lg' } },
      { id: 'vehicles', accessorFn: (r) => r.vehicles, header: 'Vehicles', size: 90, meta: { label: 'Vehicles', align: 'right' } },
      { id: 'drivers', accessorFn: (r) => r.drivers, header: 'Drivers', size: 90, meta: { label: 'Drivers', align: 'right', hideBelow: 'md' } },
      { id: 'users', accessorFn: (r) => r.users, header: 'Users', size: 80, meta: { label: 'Users', align: 'right', hideBelow: 'lg' } },
      { id: 'bayCapacity', accessorFn: (r) => r.bayCapacity, header: 'Bays', size: 80, meta: { label: 'Bay capacity', align: 'right', hideBelow: 'lg' } },
      {
        id: 'util',
        accessorFn: (r) => r.util,
        header: 'Utilisation',
        size: 150,
        meta: { label: 'Bay utilisation', exportValue: (r) => `${r.util}%` },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Progress className="h-1.5 w-16" value={Math.min(100, row.original.util)} indicatorClassName={capacityTone(row.original.util)} />
            <span className="num text-xs text-muted-foreground">{row.original.util}%</span>
          </div>
        ),
      },
      { id: 'status', accessorFn: (r) => r.status, header: 'Status', size: 100, filterFn: 'inArray', meta: { label: 'Status' }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'phone', accessorFn: (r) => r.phone, header: 'Phone', size: 140, meta: { label: 'Phone' } },
      { id: 'email', accessorFn: (r) => r.email, header: 'Email', size: 220, meta: { label: 'Email' } },
      actionsColumn<BranchRow>(rowActions) as ColumnDef<BranchRow, any>,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps.edit, caps.del],
  )

  const viewToggle = (
    <Segmented<'cards' | 'table'> aria-label="Branch view" value={view} onChange={setViewPersist} options={[{ value: 'cards', label: <><LayoutGrid className="size-3.5" /> Cards</> }, { value: 'table', label: <><Rows3 className="size-3.5" /> Table</> }]} />
  )
  const addButton = caps.create && (
    <Button size="sm" onClick={() => openForm(null)}>
      <Plus /> Add branch
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Branches & depots" value={stats.total} icon={Building2} hint={`${stats.active} active`} />
        <KpiCard label="Active" value={stats.active} icon={CircleCheck} status="success" />
        <KpiCard label="Total bay capacity" value={stats.cap} icon={Warehouse} />
        <KpiCard label="Vehicles based" value={stats.veh} icon={Truck} />
        <KpiCard label="Bay utilisation" value={stats.util} unit="%" icon={Warehouse} status={stats.over ? 'danger' : stats.util >= 85 ? 'warning' : 'success'} hint={stats.over ? `${stats.over} branch(es) over capacity` : undefined} />
      </div>

      {highlighted && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/8 px-3.5 py-2 text-[13px]">
          <span className="flex items-center gap-2"><MapPin className="size-4 text-primary" /> Showing <span className="font-medium">{highlighted.name}</span> from a link.</span>
          <span className="flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setDrawerId(highlighted.id)}>View details</Button>
            <Button size="xs" variant="ghost" onClick={onClearHighlight}><X /> Clear</Button>
          </span>
        </div>
      )}

      {view === 'table' ? (
        <DataTable<BranchRow>
          tableId="admin-branches"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          exportName={caps.exportCsv ? 'branches' : undefined}
          searchPlaceholder="Search branch, city, manager…"
          defaultHidden={['phone', 'email']}
          defaultSort={[{ id: 'name', desc: false }]}
          onRowClick={(r) => setDrawerId(r.id)}
          rowClassName={(r) => (r.id === highlightId ? 'bg-primary/10 animate-flash' : undefined)}
          facets={[
            { columnId: 'typeLabel', label: 'Type', options: Object.values(BRANCH_TYPE).map((v) => ({ value: v, label: v })) },
            { columnId: 'city', label: 'City', options: [...new Set(rows.map((r) => r.city))].sort().map((v) => ({ value: v, label: v })) },
            { columnId: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
          ]}
          actions={<>{viewToggle}{addButton}</>}
          mobileCard={(b) => <BranchMini b={b} />}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search branch, city, manager…" className="pl-8" aria-label="Search branches" />
            </div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger size="sm" className="w-40" aria-label="Branch type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All types</SelectItem>{typeOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">{viewToggle}{addButton}</div>
          </div>
          {filtered.length === 0 ? (
            <div className="panel"><EmptyState title="No branches match" description="Adjust the search or type filter." /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((b) => (
                <article
                  key={b.id}
                  id={`branch-${b.id}`}
                  className={cn('panel flex min-w-0 flex-col p-3.5 transition-colors hover:border-border-strong', b.status === 'inactive' && 'opacity-70', b.id === highlightId && 'border-primary ring-2 ring-primary/50 animate-flash')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-9 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[11px] font-semibold">{b.code}</span>
                        <StatusBadge status={b.status} />
                      </div>
                      <button type="button" onClick={() => setDrawerId(b.id)} className="mt-1.5 block max-w-full truncate text-left text-[14px] font-semibold hover:text-primary hover:underline">{b.name}</button>
                      <div className="text-xs text-muted-foreground">{BRANCH_TYPE[b.type]} · {b.city}</div>
                    </div>
                    <RowActions actions={rowActions(b)} label={`Actions for ${b.name}`} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><UserRound className="size-3.5 shrink-0" /><span className="truncate">{b.manager}</span></div>
                    <div className="flex items-center gap-1.5"><Phone className="size-3.5 shrink-0" /><a href={`tel:${b.phone.replace(/\s/g, '')}`} className="truncate hover:text-primary hover:underline">{b.phone}</a></div>
                    <div className="flex items-center gap-1.5"><Mail className="size-3.5 shrink-0" /><a href={`mailto:${b.email}`} className="truncate hover:text-primary hover:underline">{b.email}</a></div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                    <CountTile icon={Truck} label="Vehicles" value={b.vehicles} />
                    <CountTile icon={UserRound} label="Drivers" value={b.drivers} />
                    <CountTile icon={Users} label="Users" value={b.users} />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-baseline justify-between text-[11px]"><span className="text-subtle-foreground">Bay utilisation</span><span className="num text-muted-foreground">{b.vehicles} / {b.bayCapacity} · {b.util}%</span></div>
                    <Progress className="h-1.5" value={Math.min(100, b.util)} indicatorClassName={capacityTone(b.util)} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      <BranchDrawer branchId={drawerId} onClose={() => setDrawerId(null)} onEdit={(b) => openForm(b)} actions={actions} />
      <BranchFormDialog open={form.open} branch={form.branch} onOpenChange={(o) => !o && setForm((f) => ({ ...f, open: false }))} />
    </div>
  )
}

function StatusBadge({ status }: { status: Branch['status'] }) {
  const tone = status === 'active' ? 'success' : 'neutral'
  return <Badge tone={tone} className="gap-1.5"><StatusDot tone={tone} className="size-1.5 [&>span]:size-1.5" />{status === 'active' ? 'Active' : 'Inactive'}</Badge>
}

function CountTile({ icon: Icon, label, value }: { icon: typeof Truck; label: string; value: number }) {
  return (
    <div>
      <div className="num text-[15px] font-semibold leading-tight">{value}</div>
      <div className="flex items-center justify-center gap-1 text-[11px] text-subtle-foreground"><Icon className="size-3" />{label}</div>
    </div>
  )
}

function BranchMini({ b }: { b: BranchRow }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-medium">{b.name}</span><StatusBadge status={b.status} /></div>
      <div className="text-xs text-muted-foreground">{BRANCH_TYPE[b.type]} · {b.city} · {b.manager}</div>
      <div className="num text-xs text-subtle-foreground">{b.vehicles} vehicles · {b.drivers} drivers · {b.util}% bays used</div>
    </div>
  )
}

/* ------------------------------------------------------------------ drawer */
function BranchDrawer({ branchId, onClose, onEdit, actions }: { branchId: string | null; onClose: () => void; onEdit: (b: Branch) => void; actions: ReturnType<typeof useBranchActions> }) {
  const rows = useBranchRows()
  const vehicles = useDb((s) => s.vehicles)
  const drivers = useDb((s) => s.drivers)
  const users = useDb((s) => s.users)
  const geofences = useDb((s) => s.geofences)
  const caps = useAdminCaps()
  const b = rows.find((x) => x.id === branchId)
  const vs = React.useMemo(() => vehicles.filter((v) => v.branchId === branchId), [vehicles, branchId])
  const ds = React.useMemo(() => drivers.filter((d) => d.branchId === branchId), [drivers, branchId])
  const us = React.useMemo(() => users.filter((u) => u.branchId === branchId), [users, branchId])
  const gs = React.useMemo(() => geofences.filter((g) => g.branchId === branchId), [geofences, branchId])
  return (
    <Sheet open={!!b} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        {b && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">{b.name}<StatusBadge status={b.status} /></SheetTitle>
              <SheetDescription>{b.code} · {BRANCH_TYPE[b.type]} · {b.city}</SheetDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                {caps.edit && <Button size="sm" onClick={() => onEdit(b)}><Pencil /> Edit</Button>}
                <Button size="sm" variant="outline" onClick={() => { useUi.getState().setBranchId(b.id); toast.success(`Global branch filter set to ${b.name}`) }}><Filter /> Limit app to branch</Button>
                {caps.edit && <Button size="sm" variant="outline" onClick={() => actions.toggleActive(b)}>{b.status === 'active' ? <Ban /> : <CircleCheck />}{b.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>}
                {caps.del && <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={async () => { if (await actions.remove(b)) onClose() }}><Trash2 /> Delete</Button>}
              </div>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-2/40 p-3 text-center">
                <CountTile icon={Truck} label="Vehicles" value={b.vehicles} />
                <CountTile icon={UserRound} label="Drivers" value={b.drivers} />
                <CountTile icon={Users} label="Users" value={b.users} />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-xs"><span className="text-muted-foreground">Bay utilisation</span><span className="num">{b.vehicles} / {b.bayCapacity} bays · {b.util}%</span></div>
                <Progress value={Math.min(100, b.util)} indicatorClassName={capacityTone(b.util)} />
                {b.util > 100 && <p className="mt-1 text-xs text-danger">More vehicles are based here than there are bays.</p>}
              </div>
              <DetailGrid
                items={[
                  { label: 'Manager', value: b.manager },
                  { label: 'Phone', value: <a className="hover:text-primary hover:underline" href={`tel:${b.phone.replace(/\s/g, '')}`}>{b.phone}</a> },
                  { label: 'Email', value: <a className="hover:text-primary hover:underline" href={`mailto:${b.email}`}>{b.email}</a> },
                  { label: 'Coordinates', value: <span className="font-mono text-xs">{b.lat.toFixed(4)}, {b.lng.toFixed(4)}</span> },
                  { label: 'Address', value: b.address },
                  { label: 'Geofences', value: gs.length ? gs.map((g) => g.name).join(', ') : 'None' },
                ]}
              />
              <React.Suspense fallback={<Skeleton className="h-40 w-full" />}>
                <MiniMap height={170} interactive={false} center={{ lat: b.lat, lng: b.lng }} zoom={12} markers={[{ id: b.id, lat: b.lat, lng: b.lng, kind: 'depot', label: b.code }]} />
              </React.Suspense>
              <EntityList title={`Vehicles based here (${vs.length})`} empty="No vehicles assigned" items={vs.slice(0, 10).map((v) => ({ id: v.id, node: <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><EntityLink type="vehicle" id={v.id} /><span className="text-xs text-subtle-foreground">{v.make} {v.model}</span></span><Status kind="vehicle" value={v.status} /></div> }))} more={vs.length - 10} />
              <EntityList title={`Drivers (${ds.length})`} empty="No drivers assigned" items={ds.slice(0, 8).map((d) => ({ id: d.id, node: <div className="flex items-center justify-between gap-3"><EntityLink type="driver" id={d.id} avatar /><Status kind="driver" value={d.status} /></div> }))} more={ds.length - 8} />
              <EntityList title={`System users (${us.length})`} empty="No users scoped to this branch" items={us.map((u) => ({ id: u.id, node: <EntityLink type="user" id={u.id} avatar /> }))} more={0} />
              <p className="text-[11px] text-subtle-foreground"><Plate>{b.code}</Plate> · Branch ID {b.id}</p>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EntityList({ title, items, empty, more }: { title: string; items: { id: string; node: React.ReactNode }[]; empty: string; more: number }) {
  return (
    <div>
      <div className="label-xs mb-1.5">{title}</div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border">
          {items.map((i) => <li key={i.id} className="px-3 py-1.5 text-[13px]">{i.node}</li>)}
          {more > 0 && <li className="px-3 py-1.5 text-xs text-subtle-foreground">+ {more} more</li>}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ form */
function BranchFormDialog({ open, branch, onOpenChange }: { open: boolean; branch: Branch | null; onOpenChange: (o: boolean) => void }) {
  const branches = useDb((s) => s.branches)
  const vehicles = useDb((s) => s.vehicles)
  const geofences = useDb((s) => s.geofences)
  const schema = React.useMemo(
    () =>
      z.object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, 'Use 2–5 letters or digits, e.g. MSV').refine((v) => !branches.some((b) => b.id !== branch?.id && b.code === v), 'Another branch already uses this code'),
        name: z.string().trim().min(3, 'Enter the branch name').max(80),
        city: z.string().trim().min(2, 'Enter the city'),
        type: z.enum(['head_office', 'depot', 'branch', 'workshop', 'border_post']),
        status: z.enum(['active', 'inactive']),
        address: z.string().trim().min(5, 'Enter the street address'),
        manager: z.string().trim().min(3, 'Enter the manager’s name'),
        phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
        email: z.string().trim().email('Enter a valid email address'),
        lat: z.number({ error: 'Enter a latitude' }).min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
        lng: z.number({ error: 'Enter a longitude' }).min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
        bayCapacity: z.number({ error: 'Enter the number of bays' }).int('Whole bays only').min(1, 'At least 1 bay').max(500, 'Maximum 500 bays'),
        createGeofence: z.boolean(),
      }),
    [branches, branch?.id],
  )
  const defaults = React.useMemo(
    () => (branch ? { ...branch, createGeofence: false } : { code: '', name: '', city: '', type: 'depot' as const, status: 'active' as const, address: '', manager: '', phone: '+263 ', email: '', lat: -19.0154, lng: 29.1549, bayCapacity: 20, createGeofence: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branch, open],
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={branch ? `Edit ${branch.name}` : 'Add branch or depot'}
      description="Branches scope vehicles, drivers, users and reports."
      schema={schema}
      defaultValues={defaults}
      size="lg"
      submitLabel={branch ? 'Save changes' : 'Add branch'}
      onSubmit={(v) => {
        const db = useDb.getState()
        const { createGeofence, ...fields } = v
        if (branch) {
          const here = vehicles.filter((x) => x.branchId === branch.id).length
          if (fields.status === 'inactive' && branch.status === 'active' && here > 0) toast.warning(`${here} vehicles are still based at ${fields.name}`)
          db.update('branches', branch.id, fields, { summary: `Updated branch ${fields.name}` })
          toast.success(`${fields.name} updated`)
          return
        }
        const id = db.branches.some((b) => b.id === `br-${fields.code.toLowerCase()}`) ? db.nextId('branches') : `br-${fields.code.toLowerCase()}`
        const created = db.insert('branches', { id, ...fields }, { summary: `Created branch ${fields.name} (${fields.code})` })
        if (createGeofence) {
          const gid = `geo-${fields.code.toLowerCase()}`
          db.insert('geofences', { id: geofences.some((g) => g.id === gid) ? db.nextId('geofences') : gid, name: `${fields.name} yard`, kind: 'depot', lat: fields.lat, lng: fields.lng, radiusM: 500, branchId: created.id, alertOnEnter: true, alertOnExit: true }, { summary: `Created depot geofence for ${fields.name}` })
        }
        toast.success(`${created.name} added`, { description: createGeofence ? 'A 500 m depot geofence was created too.' : undefined })
      }}
    >
      {(form) => (
        <>
          <FormSection title="Identity">
            <FormGrid>
              <TextField form={form} name="name" label="Branch name" required className="sm:col-span-2" placeholder="e.g. Victoria Falls Depot" />
              <TextField form={form} name="code" label="Code" required placeholder="VFA" hint="2–5 characters, unique" />
              <TextField form={form} name="city" label="City" required />
              <SelectField form={form} name="type" label="Type" required options={typeOptions} />
              <SelectField form={form} name="status" label="Status" required options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </FormGrid>
          </FormSection>
          <FormSection title="Contact">
            <FormGrid>
              <TextField form={form} name="manager" label="Branch manager" required />
              <TextField form={form} name="phone" label="Phone" required inputMode="tel" />
              <TextField form={form} name="email" label="Email" required type="email" />
              <TextField form={form} name="address" label="Street address" required />
            </FormGrid>
          </FormSection>
          <FormSection title="Location & capacity">
            <FormGrid cols={3}>
              <NumberField form={form} name="lat" label="Latitude" required step={0.00001} />
              <NumberField form={form} name="lng" label="Longitude" required step={0.00001} />
              <NumberField form={form} name="bayCapacity" label="Bay capacity" required suffix="bays" min={1} step={1} />
            </FormGrid>
            <LocationPicker form={form} context={geofences.filter((g) => g.kind === 'depot')} height={200} />
            {!branch && <SwitchField form={form} name="createGeofence" label="Create a depot geofence" hint="A 500 m zone that raises arrival and departure alerts" />}
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}
