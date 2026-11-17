import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Activity, Check, Copy, FilePlus2, Pencil, ScrollText, Trash2, Users } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { BarList, TimeSeriesChart } from '@/components/charts/charts'
import { Avatar, Badge, type Tone } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { EntityLink } from '@/components/shared/EntityLink'
import { KpiCard } from '@/components/shared/KpiCard'
import { DetailGrid, Page, PageHeader, Panel } from '@/components/shared/Page'
import { useOpenParam } from '@/hooks/useLookup'
import { makeBuckets, sumByBucket, type Bucket } from '@/lib/analytics'
import { fmtDateTime, timeAgo, titleCase } from '@/lib/format'
import { useDb } from '@/store/db'
import type { AuditEntry } from '@/types'
import { AUDIT_ACTION_LABEL, linkableEntityType } from './lib/audit'
import { useAdminCaps } from './components/AdminBits'

const ACTION_TONE: Record<AuditEntry['action'], Tone> = { create: 'success', update: 'info', delete: 'danger', status: 'warning', login: 'neutral', export: 'outline', assign: 'info', approve: 'primary', system: 'neutral' }

function ActionBadge({ action }: { action: AuditEntry['action'] }) {
  return <Badge tone={ACTION_TONE[action]}>{AUDIT_ACTION_LABEL[action]}</Badge>
}

interface AuditRow extends AuditEntry {
  ts: number
  entityLabel: string
  linkType: ReturnType<typeof linkableEntityType>
}

type Preset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom'
const DAY = 864e5
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function hourBuckets(from: number, to: number): Bucket[] {
  const out: Bucket[] = []
  const start = new Date(from)
  start.setMinutes(0, 0, 0)
  for (let t = start.getTime(); t <= to; t += 36e5) {
    const d = new Date(t)
    out.push({ key: String(t), label: `${String(d.getHours()).padStart(2, '0')}:00`, title: d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), start: t, end: t + 36e5 })
  }
  return out
}

export default function AuditPage() {
  const auditLog = useDb((s) => s.auditLog)
  const caps = useAdminCaps()
  const [openId, setOpenId] = useOpenParam()
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState(() => isoDay(Date.now() - 30 * DAY))
  const [customTo, setCustomTo] = useState(() => isoDay(Date.now()))

  const all = useMemo<AuditRow[]>(
    () =>
      auditLog.map((e) => ({ ...e, ts: new Date(e.at).getTime(), entityLabel: titleCase(e.entityType), linkType: linkableEntityType(e.entityType) })).sort((a, b) => b.ts - a.ts),
    [auditLog],
  )

  const range = useMemo(() => {
    const now = Date.now()
    if (preset === 'all') return { from: 0, to: now }
    if (preset === 'custom') return { from: new Date(`${customFrom}T00:00:00`).getTime() || 0, to: new Date(`${customTo}T23:59:59`).getTime() || now }
    const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[preset]
    return { from: now - days * DAY, to: now }
  }, [preset, customFrom, customTo, auditLog.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => all.filter((r) => r.ts >= range.from && r.ts <= range.to), [all, range])

  useEffect(() => {
    if (openId && !all.some((r) => r.id === openId)) {
      toast.error('Audit entry not found')
      setOpenId(null)
    }
  }, [openId, all, setOpenId])

  const stats = useMemo(() => {
    const users = new Set(rows.map((r) => r.userId))
    const c = (a: AuditEntry['action'][]) => rows.filter((r) => a.includes(r.action)).length
    return { total: rows.length, users: users.size, created: c(['create']), updated: c(['update', 'status', 'assign', 'approve']), deleted: c(['delete']), other: c(['login', 'export', 'system']) }
  }, [rows])

  const chart = useMemo(() => {
    const first = rows.length ? rows[rows.length - 1]!.ts : range.to
    const from = Math.max(range.from, first)
    const span = (range.to - from) / DAY
    const buckets = span <= 2.1 ? hourBuckets(from, range.to) : makeBuckets(new Date(from), new Date(range.to), span <= 31 ? 'day' : span <= 150 ? 'week' : 'month')
    const pick = (a: AuditEntry['action'][]) => sumByBucket(rows.filter((r) => a.includes(r.action)), buckets, (r) => r.ts)
    const created = pick(['create'])
    const updated = pick(['update', 'status', 'assign', 'approve'])
    const deleted = pick(['delete'])
    const other = pick(['login', 'export', 'system'])
    return buckets.map((b, i) => ({ label: b.label, title: b.title, created: created[i]!, updated: updated[i]!, deleted: deleted[i]!, other: other[i]! }))
  }, [rows, range])

  const topUsers = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.userName, (m.get(r.userName) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [rows])

  const columns = useMemo<ColumnDef<AuditRow, any>[]>(
    () => [
      {
        id: 'at',
        accessorFn: (r) => r.at,
        header: 'Time',
        size: 160,
        meta: { label: 'Time', exportValue: (r) => r.at },
        cell: ({ row }) => (
          <div className="leading-tight">
            <div className="num text-[13px]">{fmtDateTime(row.original.at)}</div>
            <div className="text-[11px] text-subtle-foreground">{timeAgo(row.original.at)}</div>
          </div>
        ),
      },
      {
        id: 'userName',
        accessorFn: (r) => r.userName,
        header: 'User',
        size: 170,
        filterFn: 'inArray',
        meta: { label: 'User' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.userName} size={22} />
            {row.original.userId.startsWith('usr-') ? <EntityLink type="user" id={row.original.userId}>{row.original.userName}</EntityLink> : <span className="truncate">{row.original.userName}</span>}
          </div>
        ),
      },
      { id: 'action', accessorFn: (r) => r.action, header: 'Action', size: 100, filterFn: 'inArray', meta: { label: 'Action', exportValue: (r) => AUDIT_ACTION_LABEL[r.action] }, cell: ({ row }) => <ActionBadge action={row.original.action} /> },
      { id: 'entityLabel', accessorFn: (r) => r.entityLabel, header: 'Entity type', size: 120, filterFn: 'inArray', meta: { label: 'Entity type', hideBelow: 'md' } },
      {
        id: 'entityId',
        accessorFn: (r) => r.entityId,
        header: 'Entity',
        size: 140,
        meta: { label: 'Entity', hideBelow: 'lg' },
        cell: ({ row }) =>
          row.original.linkType ? <EntityLink type={row.original.linkType} id={row.original.entityId} fallback={row.original.entityId} /> : <span className="font-mono text-xs text-subtle-foreground">{row.original.entityId}</span>,
      },
      { id: 'summary', accessorFn: (r) => r.summary, header: 'Summary', size: 440, meta: { label: 'Summary' }, cell: ({ row }) => <span title={row.original.summary}>{row.original.summary}</span> },
      { id: 'id', accessorFn: (r) => r.id, header: 'Entry ID', size: 120, meta: { label: 'Entry ID' }, cell: ({ row }) => <span className="font-mono text-xs text-subtle-foreground">{row.original.id}</span> },
    ],
    [],
  )

  const userOptions = useMemo(() => [...new Set(all.map((r) => r.userName))].sort().map((v) => ({ value: v, label: v })), [all])
  const entityOptions = useMemo(() => [...new Set(all.map((r) => r.entityLabel))].sort().map((v) => ({ value: v, label: v })), [all])
  const opened = all.find((r) => r.id === openId)

  return (
    <Page>
      <PageHeader title="Audit log" description="A tamper-evident trail of who changed what, and when. Every create, update, delete, approval and export across FleetCore is recorded here." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Events" value={stats.total} icon={ScrollText} hint="Entries in the selected period" />
        <KpiCard label="Active users" value={stats.users} icon={Users} />
        <KpiCard label="Created" value={stats.created} icon={FilePlus2} status="success" />
        <KpiCard label="Updated" value={stats.updated} icon={Pencil} />
        <KpiCard label="Deleted" value={stats.deleted} icon={Trash2} status={stats.deleted ? 'warning' : undefined} />
        <KpiCard label="Sign-ins, exports & system" value={stats.other} icon={Activity} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Activity over time" description="Events per period by type">
          <TimeSeriesChart
            height={190}
            data={chart}
            titleKey="title"
            stacked
            series={[
              { key: 'created', label: 'Created', type: 'bar', color: 'var(--chart-1)' },
              { key: 'updated', label: 'Updated', type: 'bar', color: 'var(--chart-2)' },
              { key: 'deleted', label: 'Deleted', type: 'bar', color: 'var(--chart-6)' },
              { key: 'other', label: 'Sign-ins & other', type: 'bar', color: 'var(--chart-7)' },
            ]}
            empty="No audit events in this period"
          />
        </Panel>
        <Panel title="Most active users" description="Events in the selected period">
          <BarList items={topUsers.map(([name, n]) => ({ label: name, value: n }))} emptyText="No activity in this period" />
        </Panel>
      </div>

      <DataTable<AuditRow>
        tableId="admin-audit"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={caps.exportCsv ? 'audit-log' : undefined}
        searchPlaceholder="Search summary, user, entity…"
        defaultSort={[{ id: 'at', desc: true }]}
        defaultHidden={['id']}
        defaultPageSize={25}
        onRowClick={(r) => setOpenId(r.id)}
        facets={[
          { columnId: 'userName', label: 'User', options: userOptions },
          { columnId: 'action', label: 'Action', options: (Object.keys(AUDIT_ACTION_LABEL) as AuditEntry['action'][]).map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] })) },
          { columnId: 'entityLabel', label: 'Entity', options: entityOptions },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Preset>
              aria-label="Date range"
              value={preset}
              onChange={setPreset}
              options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }, { value: '90d', label: '90d' }, { value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' }]}
            />
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <Input type="date" aria-label="From date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 w-[8.5rem] text-xs" />
                <span className="text-xs text-subtle-foreground">to</span>
                <Input type="date" aria-label="To date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="h-7 w-[8.5rem] text-xs" />
              </div>
            )}
          </div>
        }
        emptyTitle="No audit entries"
        emptyDescription="Nothing was recorded for this period and filter combination."
        mobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <ActionBadge action={r.action} />
              <span className="num text-[11px] text-subtle-foreground">{timeAgo(r.at)}</span>
            </div>
            <p className="text-[13px]">{r.summary}</p>
            <p className="text-xs text-muted-foreground">{r.userName} · {r.entityLabel}</p>
          </div>
        )}
      />

      <AuditDrawer entry={opened} all={all} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </Page>
  )
}

function AuditDrawer({ entry, all, onClose, onOpen }: { entry: AuditRow | undefined; all: AuditRow[]; onClose: () => void; onOpen: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const related = useMemo(() => (entry ? all.filter((r) => r.entityId === entry.entityId && r.id !== entry.id).slice(0, 6) : []), [all, entry])
  const raw = useMemo(() => {
    if (!entry) return ''
    const { ts: _ts, entityLabel: _l, linkType: _t, ...clean } = entry
    void _ts; void _l; void _t
    return JSON.stringify(clean, null, 2)
  }, [entry])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      toast.success('Audit entry copied as JSON')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not access the clipboard')
    }
  }

  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><ActionBadge action={entry.action} /> Audit entry</SheetTitle>
              <SheetDescription className="font-mono">{entry.id}</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <p className="rounded-lg border border-border bg-surface-2/50 p-3 text-[13px]">{entry.summary}</p>
              <DetailGrid
                items={[
                  { label: 'Time', value: fmtDateTime(entry.at) },
                  { label: 'Relative', value: timeAgo(entry.at) },
                  { label: 'User', value: entry.userId.startsWith('usr-') ? <EntityLink type="user" id={entry.userId} avatar>{entry.userName}</EntityLink> : entry.userName },
                  { label: 'Action', value: AUDIT_ACTION_LABEL[entry.action] },
                  { label: 'Entity type', value: entry.entityLabel },
                  { label: 'Entity', value: entry.linkType ? <EntityLink type={entry.linkType} id={entry.entityId} fallback={entry.entityId} /> : <span className="font-mono text-xs">{entry.entityId}</span> },
                ]}
              />
              {related.length > 0 && (
                <div>
                  <div className="label-xs mb-1.5">Other entries for this entity</div>
                  <ul className="divide-y divide-border/70 rounded-lg border border-border">
                    {related.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-accent/40">
                          <span className="truncate">{r.summary}</span>
                          <span className="num shrink-0 text-subtle-foreground">{timeAgo(r.at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="label-xs">Raw entry</div>
                  <Button size="xs" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />} Copy JSON</Button>
                </div>
                <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground">{raw}</pre>
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
