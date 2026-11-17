import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { subWeeks } from 'date-fns'
import { z } from 'zod'
import { toast } from 'sonner'
import { Ban, CheckCircle2, Eye, Fuel, MapPin, Pencil, Plus, Tag, TrendingDown, Wallet, Droplets, DollarSign } from 'lucide-react'
import type { FuelStation } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DataTable, actionsColumn, type BulkAction } from '@/components/data-table/DataTable'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, FormGrid, NumberField, SelectField, TextField } from '@/components/forms/fields'
import { VehicleLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { useDb } from '@/store/db'
import { confirm } from '@/store/confirm'
import { PLACES } from '@/data/places'
import { useBranchScope, useDateRange } from '@/hooks/useFilters'
import { useOpenParam } from '@/hooks/useLookup'
import { useMoney } from '@/hooks/useMoney'
import { avgByBucket, makeBuckets } from '@/lib/analytics'
import { fmtDate, fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PriceSpark, PriceTrendChart, Stat } from './components'
import { useFuelPerms, useFuelRows, useNewParam } from './hooks'

interface StationRow extends FuelStation {
  litres: number
  spend: number
  fills: number
  lastFill: string | null
  avgPaid: number
  trend: number[]
  vsAvgDiesel: number
}

const BRANDS = ['Puma Energy', 'Zuva Petroleum', 'TotalEnergies', 'Independent']
const CITY_OPTIONS = PLACES.filter((p) => p.kind !== 'suburb').map((p) => ({ value: p.name, label: p.name }))

const stationSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(3, 'Enter the station name').max(60, 'Max 60 characters'),
    brand: z.string().min(1, 'Select a brand'),
    city: z.string().min(1, 'Select a city'),
    address: z.string().trim().min(3, 'Enter the address').max(120, 'Max 120 characters'),
    dieselPriceUsd: z.number({ error: 'Enter the diesel price' }).min(0.5, 'Price looks too low').max(5, 'Price looks too high'),
    petrolPriceUsd: z.number({ error: 'Enter the petrol price' }).min(0.5, 'Price looks too low').max(5, 'Price looks too high'),
    status: z.enum(['approved', 'suspended']),
  })
  .superRefine((v, ctx) => {
    const dup = useDb.getState().fuelStations.find((s) => s.id !== v.id && s.name.trim().toLowerCase() === v.name.trim().toLowerCase())
    if (dup) ctx.addIssue({ code: 'custom', path: ['name'], message: 'A station with this name already exists' })
  })

const priceSchema = z
  .object({ dieselPriceUsd: z.number().min(0.5, 'Price looks too low').max(5, 'Price looks too high').optional(), petrolPriceUsd: z.number().min(0.5, 'Price looks too low').max(5, 'Price looks too high').optional() })
  .refine((v) => v.dieselPriceUsd !== undefined || v.petrolPriceUsd !== undefined, { path: ['dieselPriceUsd'], message: 'Enter at least one price' })

async function setStatus(rows: { id: string; name: string; status: FuelStation['status'] }[], status: FuelStation['status']) {
  const targets = rows.filter((r) => r.status !== status)
  if (!targets.length) return toast.info(`Already ${status}`)
  const suspend = status === 'suspended'
  if (suspend && !(await confirm({ title: targets.length === 1 ? `Suspend ${targets[0]!.name}?` : `Suspend ${targets.length} stations?`, description: 'No new transactions can be recorded at suspended stations. Existing history is kept.', confirmLabel: 'Suspend', destructive: true }))) return
  useDb.getState().updateMany('fuelStations', targets.map((t) => t.id), { status }, { action: 'status', summary: `${suspend ? 'Suspended' : 'Approved'} ${targets.length === 1 ? targets[0]!.name : `${targets.length} fuel stations`}` })
  toast.success(targets.length === 1 ? `${targets[0]!.name} ${suspend ? 'suspended' : 'approved'}` : `${targets.length} stations ${suspend ? 'suspended' : 'approved'}`)
}

export default function StationsPage() {
  const money = useMoney()
  const range = useDateRange()
  const { scope } = useBranchScope()
  const perms = useFuelPerms()
  const stations = useDb((s) => s.fuelStations)
  const allRows = useFuelRows()
  const [openId, setOpenId] = useOpenParam()
  const [dialog, setDialog] = useState<{ kind: 'edit'; station?: FuelStation } | { kind: 'prices'; ids: string[]; clear?: () => void } | null>(null)
  const [fuelView, setFuelView] = useState<'diesel' | 'petrol'>('diesel')
  useNewParam(() => setDialog({ kind: 'edit' }), perms.canManage)

  const rows = useMemo<StationRow[]>(() => {
    const scoped = scope(allRows)
    const inRange = scoped.filter((r) => range.inRange(r.date))
    const buckets = makeBuckets(subWeeks(new Date(), 11), new Date(), 'week')
    const byStation = new Map<string, typeof scoped>()
    for (const r of scoped) {
      const l = byStation.get(r.stationId)
      if (l) l.push(r)
      else byStation.set(r.stationId, [r])
    }
    const rangeBy = new Map<string, typeof inRange>()
    for (const r of inRange) {
      const l = rangeBy.get(r.stationId)
      if (l) l.push(r)
      else rangeBy.set(r.stationId, [r])
    }
    const avgDiesel = stations.length ? stations.reduce((a, s) => a + s.dieselPriceUsd, 0) / stations.length : 0
    return stations.map((s) => {
      const all = byStation.get(s.id) ?? []
      const rg = rangeBy.get(s.id) ?? []
      const litres = rg.reduce((a, r) => a + r.litres, 0)
      const spend = rg.reduce((a, r) => a + r.totalUsd, 0)
      let trend = avgByBucket(all, buckets, (r) => r.date, (r) => r.pricePerLitreUsd)
      const first = trend.find((v) => v > 0)
      let last = first ?? 0
      trend = trend.map((v) => (v > 0 ? (last = v) : last))
      return { ...s, litres, spend, fills: rg.length, lastFill: all.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null), avgPaid: litres ? spend / litres : 0, trend: first ? trend : [], vsAvgDiesel: s.dieselPriceUsd - avgDiesel }
    })
  }, [stations, allRows, scope, range])

  const openRow = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId])
  const approved = rows.filter((r) => r.status === 'approved')
  const kpi = useMemo(() => {
    const avg = (f: (s: StationRow) => number) => (approved.length ? approved.reduce((a, s) => a + f(s), 0) / approved.length : 0)
    const cheapest = [...approved].sort((a, b) => a.dieselPriceUsd - b.dieselPriceUsd)[0]
    return { diesel: avg((s) => s.dieselPriceUsd), petrol: avg((s) => s.petrolPriceUsd), cheapest, spend: rows.reduce((a, s) => a + s.spend, 0), litres: rows.reduce((a, s) => a + s.litres, 0) }
  }, [rows, approved])

  const cheapestByCity = useMemo(() => {
    const m = new Map<string, StationRow>()
    const key = (s: StationRow) => (fuelView === 'diesel' ? s.dieselPriceUsd : s.petrolPriceUsd)
    for (const s of approved) {
      const cur = m.get(s.city)
      if (!cur || key(s) < key(cur)) m.set(s.city, s)
    }
    const avg = approved.length ? approved.reduce((a, s) => a + key(s), 0) / approved.length : 0
    return [...m.values()].sort((a, b) => key(a) - key(b)).map((s) => ({ s, price: key(s), saving: avg - key(s) }))
  }, [approved, fuelView])

  const columns = useMemo<ColumnDef<StationRow, any>[]>(
    () => [
      { id: 'name', header: 'Station', size: 230, accessorFn: (r) => r.name, cell: ({ row }) => (<div className="leading-tight"><div className="truncate font-medium">{row.original.name}</div><div className="truncate text-[11px] text-subtle-foreground">{row.original.address}</div></div>) },
      { id: 'brand', header: 'Brand', size: 130, accessorFn: (r) => r.brand },
      { id: 'city', header: 'City', size: 100, accessorFn: (r) => r.city },
      { id: 'diesel', header: 'Diesel /L', size: 105, accessorFn: (r) => r.dieselPriceUsd, cell: ({ row }) => (<span className="inline-flex items-center gap-1.5">{money(row.original.dieselPriceUsd, { digits: 2 })}<span className={cn('text-[11px]', row.original.vsAvgDiesel > 0.005 ? 'text-danger' : row.original.vsAvgDiesel < -0.005 ? 'text-success' : 'text-subtle-foreground')}>{row.original.vsAvgDiesel >= 0 ? '+' : '−'}{Math.abs(row.original.vsAvgDiesel * 100).toFixed(0)}¢</span></span>), meta: { align: 'right', exportValue: (r) => r.dieselPriceUsd } },
      { id: 'petrol', header: 'Petrol /L', size: 90, accessorFn: (r) => r.petrolPriceUsd, cell: ({ row }) => money(row.original.petrolPriceUsd, { digits: 2 }), meta: { align: 'right', exportValue: (r) => r.petrolPriceUsd } },
      { id: 'trend', header: 'Price trend (12 wk)', size: 130, enableSorting: false, accessorFn: (r) => (r.avgPaid ? Number(r.avgPaid.toFixed(3)) : undefined), cell: ({ row }) => <PriceSpark data={row.original.trend} />, meta: { label: 'Avg price paid', exportValue: (r) => (r.avgPaid ? Number(r.avgPaid.toFixed(3)) : '') } },
      { id: 'litres', header: 'Litres', size: 90, accessorFn: (r) => Math.round(r.litres), cell: ({ row }) => fmtNumber(row.original.litres), meta: { align: 'right', label: `Litres (${range.label})` } },
      { id: 'spend', header: 'Spend', size: 100, accessorFn: (r) => Math.round(r.spend), cell: ({ row }) => money(row.original.spend), meta: { align: 'right', label: `Spend (${range.label})`, exportValue: (r) => Math.round(r.spend) } },
      { id: 'fills', header: 'Fills', size: 70, accessorFn: (r) => r.fills, meta: { align: 'right' } },
      { id: 'lastFill', header: 'Last fill', size: 105, accessorFn: (r) => r.lastFill ?? '', cell: ({ row }) => <span className="text-muted-foreground">{row.original.lastFill ? timeAgo(row.original.lastFill) : '—'}</span> },
      { id: 'status', header: 'Status', size: 100, accessorFn: (r) => (r.status === 'approved' ? 'Approved' : 'Suspended'), cell: ({ row }) => <Badge tone={row.original.status === 'approved' ? 'success' : 'danger'}>{row.original.status === 'approved' ? 'Approved' : 'Suspended'}</Badge> },
      actionsColumn<StationRow>((r) => actions(r)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [money, perms.canEdit, range.label],
  )

  function actions(r: StationRow) {
    return [
      { label: 'View details', icon: <Eye />, onClick: () => setOpenId(r.id) },
      { label: 'Edit station', icon: <Pencil />, hidden: !perms.canEdit, onClick: () => setDialog({ kind: 'edit', station: r }) },
      { label: 'Update prices', icon: <Tag />, hidden: !perms.canEdit, onClick: () => setDialog({ kind: 'prices', ids: [r.id] }) },
      { label: r.status === 'approved' ? 'Suspend station' : 'Approve station', icon: r.status === 'approved' ? <Ban /> : <CheckCircle2 />, hidden: !perms.canEdit, destructive: r.status === 'approved', separatorBefore: true, onClick: () => void setStatus([r], r.status === 'approved' ? 'suspended' : 'approved') },
    ]
  }

  const bulk: BulkAction<StationRow>[] = perms.canEdit
    ? [
        { label: 'Update prices', icon: <Tag />, onClick: (sel, clear) => setDialog({ kind: 'prices', ids: sel.map((s) => s.id), clear }) },
        { label: 'Approve', icon: <CheckCircle2 />, onClick: (sel, clear) => { void setStatus(sel, 'approved'); clear() } },
        { label: 'Suspend', icon: <Ban />, destructive: true, onClick: (sel, clear) => { void setStatus(sel, 'suspended'); clear() } },
      ]
    : []

  const edit = dialog?.kind === 'edit' ? dialog.station : undefined

  return (
    <Page>
      <PageHeader
        title="Fuel stations"
        description="Approved supplier directory with price lists, volumes and price trends."
        actions={perms.canManage && <Button onClick={() => setDialog({ kind: 'edit' })}><Plus /> Add station</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Stations" icon={Fuel} value={rows.length} hint={`${approved.length} approved · ${rows.length - approved.length} suspended`} />
        <KpiCard label="Avg diesel" icon={DollarSign} value={kpi.diesel} format={(n) => money(n, { digits: 2 })} unit="/ L" />
        <KpiCard label="Avg petrol" icon={DollarSign} value={kpi.petrol} format={(n) => money(n, { digits: 2 })} unit="/ L" />
        <KpiCard label="Cheapest diesel" icon={TrendingDown} value={kpi.cheapest ? money(kpi.cheapest.dieselPriceUsd, { digits: 2 }) : '—'} hint={kpi.cheapest ? `${kpi.cheapest.name}, ${kpi.cheapest.city}` : undefined} />
        <KpiCard label={`Spend · ${range.label}`} icon={Wallet} value={kpi.spend} format={(n) => money(n, { compact: true })} />
        <KpiCard label={`Litres · ${range.label}`} icon={Droplets} value={kpi.litres} format={(n) => fmtNumber(n)} unit="L" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
        <Panel
          title="Cheapest by city"
          description="Lowest approved price per litre"
          actions={<Segmented aria-label="Fuel type" size="xs" value={fuelView} onChange={setFuelView} options={[{ value: 'diesel', label: 'Diesel' }, { value: 'petrol', label: 'Petrol' }]} />}
          flush
          className="xl:col-span-1"
        >
          <ul className="divide-y divide-border">
            {cheapestByCity.map(({ s, price, saving }, i) => (
              <li key={s.city}>
                <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent/40">
                  <span className="num w-4 text-xs text-subtle-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13px] font-medium">{s.city}</span>
                    <span className="block truncate text-[11px] text-subtle-foreground">{s.name}</span>
                  </span>
                  <span className="text-right leading-tight">
                    <span className="num block text-[13px] font-semibold">{money(price, { digits: 2 })}</span>
                    <span className={cn('num block text-[11px]', saving > 0 ? 'text-success' : 'text-subtle-foreground')}>{saving >= 0 ? '−' : '+'}{Math.abs(saving * 100).toFixed(1)}¢ vs avg</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="xl:col-span-3">
          <DataTable
            tableId="fuel-stations"
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            searchPlaceholder="Search station, brand, city…"
            facets={[
              { columnId: 'brand', label: 'Brand', options: BRANDS.map((b) => ({ value: b, label: b })) },
              { columnId: 'city', label: 'City', options: [...new Set(stations.map((s) => s.city))].sort().map((c) => ({ value: c, label: c })) },
              { columnId: 'status', label: 'Status', options: [{ value: 'Approved', label: 'Approved' }, { value: 'Suspended', label: 'Suspended' }] },
            ]}
            selectable={bulk.length > 0 || perms.canExport}
            bulkActions={bulk}
            exportName={perms.canExport ? 'fuel-stations' : undefined}
            defaultSort={[{ id: 'spend', desc: true }]}
            defaultHidden={['fills']}
            onRowClick={(r) => setOpenId(r.id)}
            mobileCard={(r) => (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status === 'approved' ? 'Approved' : 'Suspended'}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{r.brand} · {r.city}</span>
                  <span className="num">D {money(r.dieselPriceUsd, { digits: 2 })} · P {money(r.petrolPriceUsd, { digits: 2 })}</span>
                </div>
                <div className="num text-xs text-subtle-foreground">{fmtNumber(r.litres)} L · {money(r.spend)} in range</div>
              </div>
            )}
          />
        </div>
      </div>

      <StationDrawer row={openRow} onClose={() => setOpenId(null)} actions={actions} />

      <FormDialog
        open={dialog?.kind === 'edit'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={edit ? `Edit ${edit.name}` : 'Add fuel station'}
        description={edit ? 'Update the station details and price list.' : 'Register a new supplier station. Approved stations can be selected when recording fuel.'}
        schema={stationSchema}
        defaultValues={{ id: edit?.id ?? '', name: edit?.name ?? '', brand: edit?.brand ?? BRANDS[0]!, city: edit?.city ?? '', address: edit?.address ?? '', dieselPriceUsd: edit?.dieselPriceUsd ?? (undefined as unknown as number), petrolPriceUsd: edit?.petrolPriceUsd ?? (undefined as unknown as number), status: edit?.status ?? 'approved' }}
        submitLabel={edit ? 'Save changes' : 'Add station'}
        onSubmit={(v) => {
          const db = useDb.getState()
          const place = PLACES.find((p) => p.name === v.city)
          if (edit) {
            const moved = edit.city !== v.city && place
            const priceNote = edit.dieselPriceUsd !== v.dieselPriceUsd || edit.petrolPriceUsd !== v.petrolPriceUsd ? ` (diesel $${edit.dieselPriceUsd.toFixed(2)} → $${v.dieselPriceUsd.toFixed(2)}, petrol $${edit.petrolPriceUsd.toFixed(2)} → $${v.petrolPriceUsd.toFixed(2)})` : ''
            db.update('fuelStations', edit.id, { name: v.name.trim(), brand: v.brand, city: v.city, address: v.address.trim(), dieselPriceUsd: v.dieselPriceUsd, petrolPriceUsd: v.petrolPriceUsd, status: v.status, ...(moved ? { lat: place.lat, lng: place.lng } : {}) }, { summary: `Updated fuel station ${v.name.trim()}${priceNote}` })
            toast.success(`${v.name.trim()} updated`)
          } else {
            const rec = db.insert('fuelStations', { name: v.name.trim(), brand: v.brand, city: v.city, address: v.address.trim(), lat: (place?.lat ?? -19.0) + (Math.random() - 0.5) * 0.02, lng: (place?.lng ?? 30.0) + (Math.random() - 0.5) * 0.02, dieselPriceUsd: v.dieselPriceUsd, petrolPriceUsd: v.petrolPriceUsd, status: v.status })
            toast.success(`${rec.name} added`)
          }
        }}
      >
        {(form) => (
          <>
            <TextField form={form} name="name" label="Station name" required placeholder="e.g. Puma Energy Marondera" />
            <FormGrid>
              <SelectField form={form} name="brand" label="Brand" required options={BRANDS.map((b) => ({ value: b, label: b }))} />
              <ComboField form={form} name="city" label="City / town" required options={CITY_OPTIONS} placeholder="Select city" searchPlaceholder="Search places…" />
            </FormGrid>
            <TextField form={form} name="address" label="Address" required placeholder="Street, suburb" />
            <FormGrid cols={3}>
              <NumberField form={form} name="dieselPriceUsd" label="Diesel / L" required prefix="$" step="0.01" min={0} />
              <NumberField form={form} name="petrolPriceUsd" label="Petrol / L" required prefix="$" step="0.01" min={0} />
              <SelectField form={form} name="status" label="Status" options={[{ value: 'approved', label: 'Approved' }, { value: 'suspended', label: 'Suspended' }]} />
            </FormGrid>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog?.kind === 'prices'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Update prices"
        description={dialog?.kind === 'prices' ? `Set new pump prices for ${dialog.ids.length} station${dialog.ids.length === 1 ? '' : 's'}. Leave a field empty to keep its current price.` : undefined}
        schema={priceSchema}
        defaultValues={{ dieselPriceUsd: undefined, petrolPriceUsd: undefined }}
        submitLabel="Apply prices"
        onSubmit={(v) => {
          if (dialog?.kind !== 'prices') return
          const patch: Partial<FuelStation> = {}
          if (v.dieselPriceUsd !== undefined) patch.dieselPriceUsd = v.dieselPriceUsd
          if (v.petrolPriceUsd !== undefined) patch.petrolPriceUsd = v.petrolPriceUsd
          useDb.getState().updateMany('fuelStations', dialog.ids, patch, { summary: `Updated fuel prices at ${dialog.ids.length} station${dialog.ids.length === 1 ? '' : 's'}${v.dieselPriceUsd !== undefined ? ` · diesel $${v.dieselPriceUsd.toFixed(2)}` : ''}${v.petrolPriceUsd !== undefined ? ` · petrol $${v.petrolPriceUsd.toFixed(2)}` : ''}` })
          toast.success(`Prices updated at ${dialog.ids.length} station${dialog.ids.length === 1 ? '' : 's'}`)
          dialog.clear?.()
        }}
      >
        {(form) => (
          <FormGrid>
            <NumberField form={form} name="dieselPriceUsd" label="Diesel / L" prefix="$" step="0.01" min={0} />
            <NumberField form={form} name="petrolPriceUsd" label="Petrol / L" prefix="$" step="0.01" min={0} />
          </FormGrid>
        )}
      </FormDialog>
    </Page>
  )
}

function StationDrawer({ row, onClose, actions }: { row: StationRow | null; onClose: () => void; actions: (r: StationRow) => { label: string; icon?: React.ReactNode; onClick: () => void; destructive?: boolean; hidden?: boolean }[] }) {
  const money = useMoney()
  const txs = useFuelRows()
  const mine = useMemo(() => (row ? txs.filter((t) => t.stationId === row.id).sort((a, b) => b.date.localeCompare(a.date)) : []), [txs, row])
  const trend = useMemo(() => {
    if (!row) return []
    const buckets = makeBuckets(subWeeks(new Date(), 15), new Date(), 'week')
    const prices = avgByBucket(mine, buckets, (r) => r.date, (r) => r.pricePerLitreUsd)
    return buckets.map((b, i) => ({ label: b.label, title: b.title, paid: Number(prices[i]!.toFixed(3)), list: row.dieselPriceUsd })).filter((d) => d.paid > 0)
  }, [mine, row])
  const topVehicles = useMemo(() => {
    const m = new Map<string, { id: string; litres: number }>()
    for (const t of mine) m.set(t.vehicleId, { id: t.vehicleId, litres: (m.get(t.vehicleId)?.litres ?? 0) + t.litres })
    return [...m.values()].sort((a, b) => b.litres - a.litres).slice(0, 5)
  }, [mine])
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        {row && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <SheetTitle>{row.name}</SheetTitle>
                <Badge tone={row.status === 'approved' ? 'success' : 'danger'}>{row.status === 'approved' ? 'Approved' : 'Suspended'}</Badge>
              </div>
              <SheetDescription className="flex items-center gap-1"><MapPin className="size-3" /> {row.address}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Diesel / L" value={money(row.dieselPriceUsd, { digits: 2 })} hint={`${row.vsAvgDiesel >= 0 ? '+' : '−'}${Math.abs(row.vsAvgDiesel * 100).toFixed(1)}¢ vs avg`} tone={row.vsAvgDiesel > 0.01 ? 'danger' : row.vsAvgDiesel < -0.01 ? 'success' : undefined} />
                <Stat label="Petrol / L" value={money(row.petrolPriceUsd, { digits: 2 })} />
                <Stat label="Litres (period)" value={`${fmtNumber(row.litres)} L`} hint={`${row.fills} fills`} />
                <Stat label="Spend (period)" value={money(row.spend)} hint={row.avgPaid ? `${money(row.avgPaid, { digits: 3 })} avg paid` : undefined} />
              </div>
              <section>
                <h3 className="label-xs mb-2">Price paid per litre · weekly average</h3>
                <PriceTrendChart data={trend} money={money} />
              </section>
              <DetailGrid
                items={[
                  { label: 'Brand', value: row.brand },
                  { label: 'City', value: row.city },
                  { label: 'Last fill', value: row.lastFill ? fmtDateTime(row.lastFill) : 'No purchases' },
                  { label: 'Coordinates', value: `${row.lat.toFixed(3)}, ${row.lng.toFixed(3)}` },
                ]}
              />
              {topVehicles.length > 0 && (
                <section>
                  <h3 className="label-xs mb-2">Top vehicles (all time)</h3>
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {topVehicles.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-2 py-1"><VehicleLink id={v.id} /><span className="num text-muted-foreground">{fmtNumber(v.litres)} L</span></li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h3 className="label-xs mb-2">Recent transactions</h3>
                {mine.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No transactions recorded at this station.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                    {mine.slice(0, 6).map((t) => (
                      <li key={t.id}>
                        <Link to={`/fuel/transactions?open=${t.id}`} className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-accent/50">
                          <span className="flex items-center gap-2"><span className="num font-medium">{t.ref}</span><span className="font-mono text-muted-foreground">{t.reg}</span><span className="text-subtle-foreground">{fmtDate(t.date)}</span></span>
                          <span className="num text-muted-foreground">{fmtNumber(t.litres, 1)} L · {money(t.totalUsd, { digits: 2 })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </SheetBody>
            <SheetFooter>
              {actions(row).filter((a) => !a.hidden && a.label !== 'View details').map((a) => (
                <Button key={a.label} size="sm" variant={a.destructive ? 'destructive' : 'outline'} onClick={a.onClick}>
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
