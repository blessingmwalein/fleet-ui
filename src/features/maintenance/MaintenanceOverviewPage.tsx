import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { startOfMonth } from 'date-fns'
import { CheckCircle2, ClipboardList, Plus, Timer, TriangleAlert, Wallet, Warehouse, Wrench, XCircle, ShieldCheck } from 'lucide-react'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useDateRange } from '@/hooks/useFilters'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { KpiCard, pctChange } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { BarList, ChartCard, DonutChart, TimeSeriesChart } from '@/components/charts/charts'
import { autoGranularity, makeBuckets, sumByBucket, type Granularity } from '@/lib/analytics'
import { fmtDate, timeAgo } from '@/lib/format'
import { WORKORDER_TYPE } from '@/config/status'
import { Status } from '@/components/shared/Status'
import { approveWorkOrders } from './lib/actions'
import { useScheduleRows, useWorkOrderRows } from './lib/data'
import { TYPE_COLOR, isOpen } from './lib/maintenance'
import { MaintenanceCalendar } from './MaintenanceCalendar'
import { useMaintenanceActions } from './components/MaintenanceActions'
import { WorkOrderDrawer } from './components/WorkOrderDrawer'
import { ReminderRow } from './components/ReminderRow'
import type { WorkOrderType } from '@/types'

type Attn = 'overdue' | 'soon' | 'requests'

export default function MaintenanceOverviewPage() {
  const rows = useWorkOrderRows()
  const schedules = useScheduleRows()
  const branches = useDb((s) => s.branches)
  const range = useDateRange()
  const money = useMoney()
  const canCreate = useCan('maintenance.create')
  const canEdit = useCan('maintenance.edit')
  const canApprove = useCan('maintenance.approve')
  const { request, sch, wo, host } = useMaintenanceActions()
  const [openWo, setOpenWo] = useState<string | null>(null)
  const [attn, setAttn] = useState<Attn>('overdue')
  const [gran, setGran] = useState<Granularity | 'auto'>('auto')
  const [costBy, setCostBy] = useState<'vehicle' | 'provider'>('vehicle')
  const [, setParams] = useSearchParams()
  void setParams

  const m = useMemo(() => {
    const now = new Date()
    const monthStart = startOfMonth(now)
    const elapsed = now.getTime() - monthStart.getTime()
    const prevStart = startOfMonth(new Date(monthStart.getTime() - 864e5))
    const prevEnd = prevStart.getTime() + elapsed
    const done = rows.filter((r) => r.status === 'completed' && r.completedAt)
    const inRange = done.filter((r) => range.inRange(r.completedAt))
    const inPrev = done.filter((r) => range.inPrevRange(r.completedAt))
    const mtd = done.filter((r) => new Date(r.completedAt!) >= monthStart).reduce((s, r) => s + r.totalCost, 0)
    const prevMtd = done.filter((r) => { const t = new Date(r.completedAt!).getTime(); return t >= prevStart.getTime() && t <= prevEnd }).reduce((s, r) => s + r.totalCost, 0)
    const avgDt = (l: typeof done) => (l.length ? l.reduce((s, r) => s + r.downtimeHours, 0) / l.length : 0)
    const prevRatio = (l: typeof done) => (l.length ? (l.filter((r) => r.type === 'preventive').length / l.length) * 100 : 0)
    return {
      done, inRange, mtd, prevMtd,
      open: rows.filter(isOpen).length,
      requests: rows.filter((r) => r.status === 'requested'),
      inShop: rows.filter((r) => r.status === 'in_progress'),
      avgDt: avgDt(inRange), prevAvgDt: avgDt(inPrev),
      ratio: prevRatio(inRange), prevRatioV: prevRatio(inPrev),
    }
  }, [rows, range])

  const overdue = useMemo(() => schedules.filter((s) => s.state === 'overdue').sort((a, b) => a.health.urgency - b.health.urgency), [schedules])
  const soon = useMemo(() => schedules.filter((s) => s.state === 'due_soon').sort((a, b) => a.health.urgency - b.health.urgency), [schedules])

  const g: Granularity = gran === 'auto' ? (range.days <= 14 ? 'day' : range.days <= 100 ? 'week' : autoGranularity(range.days)) : gran
  const buckets = useMemo(() => makeBuckets(range.from, range.to, g), [range.from, range.to, g])
  const trend = useMemo(() => {
    const at = (r: (typeof m.inRange)[number]) => r.completedAt
    const labour = sumByBucket(m.inRange, buckets, at, (r) => r.labourCostUsd)
    const parts = sumByBucket(m.inRange, buckets, at, (r) => r.partsCostUsd)
    const jobs = sumByBucket(m.inRange, buckets, at)
    const down = sumByBucket(m.inRange, buckets, at, (r) => r.downtimeHours)
    return buckets.map((b, i) => ({ label: b.label, title: b.title, labour: Math.round(labour[i]!), parts: Math.round(parts[i]!), jobs: jobs[i]!, downtime: Math.round(down[i]!), avg: jobs[i] ? Math.round((down[i]! / jobs[i]!) * 10) / 10 : 0 }))
  }, [buckets, m])

  const byType = useMemo(() => {
    const map = new Map<WorkOrderType, number>()
    for (const r of m.inRange) map.set(r.type, (map.get(r.type) ?? 0) + r.totalCost)
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([t, v]) => ({ name: WORKORDER_TYPE[t], value: Math.round(v), color: TYPE_COLOR[t] }))
  }, [m.inRange])

  const costRank = useMemo(() => {
    const map = new Map<string, { label: React.ReactNode; sub?: string; value: number }>()
    for (const r of m.inRange) {
      const key = costBy === 'vehicle' ? r.vehicleId : r.providerId
      const cur = map.get(key) ?? { label: costBy === 'vehicle' ? <VehicleLink id={r.vehicleId} /> : r.providerName, sub: costBy === 'vehicle' ? r.vehicleName : undefined, value: 0 }
      cur.value += r.totalCost
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 8)
  }, [m.inRange, costBy])

  const totalCost = m.inRange.reduce((s, r) => s + r.totalCost, 0)
  const bayCap = useMemo(() => branches.filter((b) => b.type === 'workshop').reduce((s, b) => s + b.bayCapacity, 0), [branches])

  return (
    <Page>
      <PageHeader
        title="Maintenance"
        description="Workshop activity, service calendar and maintenance cost analysis."
        actions={
          <>
            <Button variant="outline" asChild><Link to="/maintenance/schedules">Service schedules</Link></Button>
            {canCreate && <Button onClick={() => request()}><Plus /> Request maintenance</Button>}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Open work orders" value={m.open} icon={ClipboardList} status={m.requests.length ? 'warning' : 'info'} href="/maintenance/work-orders" hint={`${m.requests.length} awaiting approval · ${m.inShop.length} in the workshop`} />
        <KpiCard label="Overdue services" value={overdue.length} icon={TriangleAlert} status={overdue.length ? 'danger' : 'success'} href="/maintenance/schedules" hint={`${soon.length} more due within 14 days / 1,000 km`} />
        <KpiCard label="In workshop now" value={m.inShop.length} icon={Warehouse} status={m.inShop.length ? 'warning' : 'success'} href="/maintenance/work-orders" hint={`Central Workshop capacity: ${bayCap} bays`} />
        <KpiCard label="Cost this month" value={m.mtd} format={(n) => money(n, { compact: true })} icon={Wallet} delta={{ pct: pctChange(m.mtd, m.prevMtd), goodWhen: 'down', label: 'vs last month' }} spark={trend.map((t) => t.labour + t.parts)} hint="Completed work orders, month to date" />
        <KpiCard label="Avg downtime" value={m.avgDt} format={(n) => `${n.toFixed(1)} h`} icon={Timer} delta={{ pct: pctChange(m.avgDt, m.prevAvgDt), goodWhen: 'down' }} spark={trend.map((t) => t.avg)} sparkColor="var(--chart-3)" hint={`Per completed job · ${range.label}`} />
        <KpiCard label="Preventive ratio" value={m.ratio} format={(n) => `${n.toFixed(0)}%`} icon={ShieldCheck} status={m.ratio >= 50 ? 'success' : 'warning'} delta={{ pct: m.ratio - m.prevRatioV, label: 'pts vs prev.' }} hint="Share of completed jobs that were preventive — higher means fewer breakdowns" />
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <MaintenanceCalendar workOrders={rows} schedules={schedules} onOpenWo={setOpenWo} canCreate={canCreate} onSchedule={(date) => request({ date })} />
        </div>
        <Panel
          className="xl:col-span-4"
          title="Needs attention"
          actions={<Segmented<Attn> size="xs" aria-label="Attention list" value={attn} onChange={setAttn} options={[{ value: 'overdue', label: `Overdue ${overdue.length}` }, { value: 'soon', label: `Due soon ${soon.length}` }, { value: 'requests', label: `Requests ${m.requests.length}` }]} />}
          flush
          bodyClassName="max-h-[640px] overflow-y-auto"
        >
          {attn !== 'requests' ? (
            (attn === 'overdue' ? overdue : soon).length === 0 ? (
              <EmptyState compact icon={CheckCircle2} title={attn === 'overdue' ? 'No overdue services' : 'Nothing due soon'} description="Every service is within its interval." />
            ) : (
              <ul className="divide-y divide-border/70">
                {(attn === 'overdue' ? overdue : soon).slice(0, 15).map((s) => <ReminderRow key={s.id} s={s} canCreate={canCreate} canEdit={canEdit} onCreate={() => sch('create-wo', s)} onServiced={() => sch('serviced', s)} />)}
              </ul>
            )
          ) : m.requests.length === 0 ? (
            <EmptyState compact icon={CheckCircle2} title="No pending requests" description="All maintenance requests have been reviewed." />
          ) : (
            <ul className="divide-y divide-border/70">
              {m.requests.map((r) => (
                <li key={r.id} className="space-y-1 px-3.5 py-2.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><VehicleLink id={r.vehicleId} /><button type="button" className="num text-xs text-primary hover:underline" onClick={() => setOpenWo(r.id)}>{r.woNo}</button></span><Status kind="priority" value={r.priority} dot={false} /></div>
                  <p className="truncate">{r.title}</p>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>by {r.requestedBy} · {timeAgo(r.requestedAt)}</span>
                    {canApprove && <span className="flex gap-1"><Button size="xs" variant="soft" onClick={() => approveWorkOrders([r])}><CheckCircle2 /> Approve</Button><Button size="xs" variant="ghost" aria-label={`Reject ${r.woNo}`} onClick={() => wo('reject', r)}><XCircle /></Button></span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title="Maintenance cost trend"
          description={`${money(totalCost)} across ${m.inRange.length} completed jobs · ${range.label}`}
          actions={<Segmented<Granularity | 'auto'> size="xs" aria-label="Granularity" value={gran} onChange={setGran} options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}
        >
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={250}
            yFormat={(v) => money(v, { compact: true })}
            y2Format={(v) => String(v)}
            series={[
              { key: 'labour', label: 'Labour', type: 'bar', stack: 'cost', color: 'var(--chart-2)', format: (v) => money(v) },
              { key: 'parts', label: 'Parts', type: 'bar', stack: 'cost', color: 'var(--chart-1)', format: (v) => money(v) },
              { key: 'jobs', label: 'Jobs completed', type: 'line', axis: 'right', color: 'var(--chart-3)' },
            ]}
          />
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Cost by work type" description={range.label}>
          {byType.length === 0 ? <EmptyState compact title="No completed jobs in this period" /> : <DonutChart data={byType} centerLabel="Total cost" centerValue={money(totalCost, { compact: true })} format={(v) => money(v)} height={170} />}
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-4"
          title={costBy === 'vehicle' ? 'Cost per vehicle' : 'Cost per provider'}
          description="Top 8 · completed work orders"
          actions={<Segmented<'vehicle' | 'provider'> size="xs" aria-label="Group cost by" value={costBy} onChange={setCostBy} options={[{ value: 'vehicle', label: 'Vehicle' }, { value: 'provider', label: 'Provider' }]} />}
        >
          <BarList items={costRank.map((c) => ({ label: c.label, sub: c.sub, value: c.value }))} format={(v) => money(v)} emptyText="No completed jobs in this period" />
        </ChartCard>
        <ChartCard className="xl:col-span-5" title="Vehicle downtime" description="Hours off the road per period, and average per job">
          <TimeSeriesChart
            data={trend}
            titleKey="title"
            height={200}
            y2Format={(v) => `${v}h`}
            yFormat={(v) => `${v}h`}
            series={[
              { key: 'downtime', label: 'Downtime (h)', type: 'bar', color: 'var(--chart-3)', format: (v) => `${v} h` },
              { key: 'avg', label: 'Avg per job (h)', type: 'line', axis: 'right', color: 'var(--chart-6)', format: (v) => `${v} h` },
            ]}
          />
        </ChartCard>
        <Panel className="xl:col-span-3" title="In the workshop now" description={`${m.inShop.length} vehicle${m.inShop.length === 1 ? '' : 's'}`} flush bodyClassName="max-h-[270px] overflow-y-auto">
          {m.inShop.length === 0 ? <EmptyState compact icon={Wrench} title="Workshop is clear" /> : (
            <ul className="divide-y divide-border/70">
              {m.inShop.map((r) => (
                <li key={r.id} className="space-y-0.5 px-3.5 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2"><VehicleLink id={r.vehicleId} /><EntityLink type="workorder" id={r.id} className="num text-xs" /></div>
                  <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                  <p className="text-[11px] text-subtle-foreground">{r.providerName} · since {r.startedAt ? fmtDate(r.startedAt, 'dd MMM') : '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <WorkOrderDrawer id={openWo} onClose={() => setOpenWo(null)} />
      {host}
    </Page>
  )
}
