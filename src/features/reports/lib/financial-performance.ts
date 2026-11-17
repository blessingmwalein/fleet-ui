import { Banknote, FileClock, HandCoins, Percent, TrendingUp, Wallet } from 'lucide-react'
import type { Invoice } from '@/types'
import {
  completedTripFacts, costFacts, DAY, DIM_BRANCH, DIM_CARGO, DIM_CATEGORY, DIM_CUSTOMER, DIM_VEHICLE, inWin, invoiceShare, PERIOD_DIM, ts, type Dataset,
} from './common'
import { C, sm } from './dsl'
import { economics } from './shared'
import { fmtDateLite } from './text'
import type { ChartSpec, Fact, ReportRow, ReportSpec, TableSpec } from './types'

/** Customer invoices visible to the dataset, with the share of each attributable to the selected depot. */
function openInvoices(ds: Dataset): { inv: Invoice; share: number; open: number }[] {
  const out: { inv: Invoice; share: number; open: number }[] = []
  for (const inv of ds.all.invoices) {
    if (inv.kind !== 'customer' || inv.status === 'draft') continue
    const share = ds.branchId === 'all' ? 1 : (invoiceShare(ds, inv).find((s) => s.branch === ds.branchId)?.share ?? 0)
    if (share <= 0) continue
    const open = (inv.amountUsd - inv.paidUsd) * share
    if (open > 0.5) out.push({ inv, share, open })
  }
  return out
}
const isOverdue = (inv: Invoice, now: number) => inv.status === 'overdue' || (Date.parse(inv.dueDate) < now && inv.status !== 'paid')

export const financialPerformance: ReportSpec = {
  slug: 'financial-performance',
  dims: [PERIOD_DIM, DIM_BRANCH, DIM_CUSTOMER, DIM_CATEGORY, DIM_VEHICLE, DIM_CARGO],
  defaultGroup: 'period',
  fallbackDim: 'branch',
  metrics: ['margin', 'revenue', 'totalCost', 'marginPct', 'invoiced', 'collected'],
  defaultMetric: 'revenue',
  measures: {
    ...economics,
    tripCost: { label: 'Direct trip cost', kind: 'usd', fn: sm('tripCost'), goodWhen: 'down', hint: 'Fuel and expenses charged directly to the trip.' },
    directMargin: { label: 'Direct margin', kind: 'usd', fn: (s) => (s.m.revenue ?? 0) - (s.m.tripCost ?? 0), goodWhen: 'up', hint: 'Revenue minus costs charged directly to the trips.' },
    directPct: { label: 'Direct margin %', kind: 'pct1', fn: (s) => ((s.m.revenue ?? 0) > 0 ? (((s.m.revenue ?? 0) - (s.m.tripCost ?? 0)) / (s.m.revenue ?? 1)) * 100 : null), goodWhen: 'up', tone: { good: 35, warn: 15 } },
    invoiced: { label: 'Invoiced', kind: 'usd', fn: sm('invoiced'), hint: 'Customer invoices issued in the period (excluding drafts).' },
    collected: { label: 'Collected', kind: 'usd', fn: sm('collected'), goodWhen: 'up', hint: 'Customer payments received in the period.' },
  },
  attrs: {
    outstanding: {
      label: 'Outstanding AR', kind: 'usd', dims: ['customer'], size: 120,
      fn: (k, _d, x) => openInvoices(x.ds).filter((o) => o.inv.partyId === k).reduce((s, o) => s + o.open, 0),
    },
    overdueAr: {
      label: 'Overdue AR', kind: 'usd', dims: ['customer'], size: 110, tone: { good: 0, warn: 2000, invert: true },
      fn: (k, _d, x) => openInvoices(x.ds).filter((o) => o.inv.partyId === k && isOverdue(o.inv, x.ds.now)).reduce((s, o) => s + o.open, 0),
    },
  },
  columns: [
    { key: 'revenue', bar: true, size: 140 }, 'trips', 'km',
    { key: 'fuelCost', dims: ['period', 'branch', 'category', 'vehicle'] }, { key: 'maintCost', dims: ['period', 'branch', 'category', 'vehicle'] }, { key: 'otherCost', dims: ['period', 'branch', 'category', 'vehicle'] },
    { key: 'totalCost', dims: ['period', 'branch', 'category', 'vehicle'] }, { key: 'margin', dims: ['period', 'branch', 'category', 'vehicle'] }, { key: 'marginPct', dims: ['period', 'branch', 'category', 'vehicle'] },
    { key: 'tripCost', dims: ['customer', 'cargo'] }, { key: 'directMargin', dims: ['customer', 'cargo'] }, { key: 'directPct', dims: ['customer', 'cargo'] },
    { key: 'revPerKm' }, { key: 'costPerKm', dims: ['period', 'branch', 'category', 'vehicle'] },
    { key: 'invoiced', dims: ['period', 'branch', 'customer'] }, { key: 'collected', dims: ['period', 'branch', 'customer'] }, 'outstanding', 'overdueAr',
  ],
  kpis: [
    { measure: 'revenue', icon: Banknote, spark: true },
    { measure: 'totalCost', icon: Wallet, spark: true },
    { measure: 'margin', icon: TrendingUp, spark: true },
    { measure: 'marginPct', icon: Percent, spark: true },
    { measure: 'collected', icon: HandCoins, spark: true },
    {
      key: 'ar', label: 'Outstanding receivables', kind: 'usd', icon: FileClock, goodWhen: 'down', hint: 'Unpaid balance on issued customer invoices (as at today); overdue amounts shown in the receivables chart.',
      custom: ({ ds }) => Math.round(openInvoices(ds).reduce((s, o) => s + o.open, 0)),
    },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Revenue, cost and margin', description: 'Per period; gross margin % on the right axis', span: 2,
      series: [{ measure: 'revenue', type: 'bar', color: C.green }, { measure: 'totalCost', type: 'bar', color: C.amber }, { measure: 'marginPct', type: 'line', axis: 'right', color: C.blue }],
    },
    { id: 'rank', type: 'ranking', title: 'Ranking' },
    { id: 'share', type: 'share', title: 'Cost composition', slices: [{ measure: 'fuelCost', label: 'Fuel', color: C.green }, { measure: 'maintCost', label: 'Maintenance', color: C.blue }, { measure: 'otherCost', label: 'Other costs', color: C.amber }], centerLabel: 'operating cost' },
    {
      id: 'ageing', type: 'custom', span: 2,
      build: ({ ds }): ChartSpec | null => {
        const open = openInvoices(ds)
        const buckets = [
          { key: 'cur', label: 'Not yet due', value: 0 }, { key: 'b1', label: '1–30 days overdue', value: 0 }, { key: 'b2', label: '31–60 days overdue', value: 0 },
          { key: 'b3', label: '61–90 days overdue', value: 0 }, { key: 'b4', label: '90+ days overdue', value: 0 },
        ]
        for (const o of open) {
          const late = Math.floor((ds.now - Date.parse(o.inv.dueDate)) / DAY)
          const i = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4
          buckets[i]!.value += o.open
        }
        if (!open.length) return null
        return {
          id: 'ageing', type: 'ranking', title: 'Receivables ageing', description: 'Open customer invoices by days past due (as at today)', span: 2,
          items: buckets.map((b) => ({ key: b.key, label: b.label, value: Math.round(b.value) })), kind: 'usd', metricLabel: 'Outstanding', limit: 5, fixedOrder: true, goodWhen: 'down',
        }
      },
    },
  ],
  facts: (ds, w) => {
    const out: Fact[] = [...completedTripFacts(ds, w), ...costFacts(ds, w)]
    for (const inv of ds.all.invoices) {
      if (inv.kind !== 'customer' || inv.status === 'draft') continue
      const shares = invoiceShare(ds, inv).filter((s) => ds.branchId === 'all' || s.branch === ds.branchId)
      const issue = ts(inv.issueDate)
      for (const sh of shares) {
        const d = { customer: inv.partyId ?? '', branch: sh.branch }
        if (inWin(issue, w)) out.push({ t: issue, d, m: { invoiced: inv.amountUsd * sh.share } })
        for (const p of inv.payments) {
          const pt = ts(p.date)
          if (inWin(pt, w)) out.push({ t: pt, d, m: { collected: p.amountUsd * sh.share } })
        }
      }
    }
    return out
  },
  details: ({ ds }) => {
    const byCust = new Map<string, { open: number; overdue: number; invoices: number; oldest: number }>()
    for (const o of openInvoices(ds)) {
      if (!isOverdue(o.inv, ds.now)) continue
      const k = o.inv.partyId ?? o.inv.partyName
      const x = byCust.get(k) ?? { open: 0, overdue: 0, invoices: 0, oldest: ds.now }
      x.open += o.open
      x.overdue += o.open
      x.invoices++
      x.oldest = Math.min(x.oldest, Date.parse(o.inv.dueDate))
      byCust.set(k, x)
    }
    const rows: ReportRow[] = [...byCust.entries()]
      .sort((a, b) => b[1].overdue - a[1].overdue)
      .slice(0, 12)
      .map(([k, x]) => {
        const c = ds.customerById.get(k)
        return {
          id: k,
          label: c?.name ?? k,
          entity: c ? { type: 'customer' as const, id: c.id } : undefined,
          sub: c?.city,
          v: { invoices: x.invoices, overdue: Math.round(x.overdue), oldest: fmtDateLite(new Date(x.oldest).toISOString()), days: Math.floor((ds.now - x.oldest) / DAY), terms: c ? `${c.paymentTermsDays} days` : '—' },
        }
      })
    const t: TableSpec = {
      id: 'overdue', title: 'Overdue receivables by customer', description: 'Customers with overdue invoices today, largest first', groupLabel: 'Customer', clickable: true,
      columns: [
        { key: 'invoices', label: 'Overdue invoices', kind: 'int', size: 130 }, { key: 'overdue', label: 'Overdue amount', kind: 'usd', size: 130 },
        { key: 'oldest', label: 'Oldest due date', kind: 'text', size: 130 }, { key: 'days', label: 'Days overdue', kind: 'int', size: 110, tone: { good: 0, warn: 30, invert: true } }, { key: 'terms', label: 'Payment terms', kind: 'text', size: 110, hideBelow: 'md' },
      ],
      rows,
      defaultSort: { id: 'overdue', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'Revenue is recognised when a trip completes. Operating cost = fuel + maintenance + other claims in the period. Gross margin = revenue − operating cost.',
    'Invoiced and collected use customer invoices issued / payments received in the period; when a depot is selected, each invoice is apportioned by the trip revenue earned in that depot.',
    'Customer views show direct margin (revenue minus costs charged to the customer’s trips) because fleet-level costs cannot be attributed to customers.',
    'Receivables are a snapshot as at today and ignore the date range; drafts are excluded.',
  ],
}
