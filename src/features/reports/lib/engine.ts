import { autoGranularity, bucketIndex, makeBuckets, type Bucket } from '@/lib/analytics'
import { addFact, emptySums, PERIOD_DIM, round } from './common'
import type {
  ChartDef, ChartSpec, ColSpec, Computed, DimDef, Fact, KpiSpec, MeasureDef, ReportResult, ReportRow, ReportSpec, RunCtx, Sums, TableSpec, TrendSeriesSpec, ValueKind,
} from './types'

export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-8)', 'var(--chart-7)', 'var(--chart-6)']

type KeyFn = (f: Fact) => string

function aggregate(facts: Fact[], keyOf: KeyFn, distinctDims: string[] | undefined): Map<string, Sums> {
  const out = new Map<string, Sums>()
  for (const f of facts) {
    const k = keyOf(f)
    let s = out.get(k)
    if (!s) {
      s = emptySums()
      out.set(k, s)
    }
    addFact(s, f, distinctDims)
  }
  return out
}

function totalSums(facts: Fact[], distinctDims: string[] | undefined): Sums {
  const s = emptySums()
  for (const f of facts) addFact(s, f, distinctDims)
  return s
}

function bucketSums(facts: Fact[], buckets: Bucket[], distinctDims: string[] | undefined): Sums[] {
  const out = buckets.map(() => emptySums())
  for (const f of facts) {
    const i = bucketIndex(buckets, f.t)
    if (i >= 0) addFact(out[i]!, f, distinctDims)
  }
  return out
}

const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v)

export function dimOf(spec: ReportSpec, value: string): DimDef {
  return spec.dims.find((d) => d.value === value) ?? PERIOD_DIM
}

export function runReport(spec: ReportSpec, rc: RunCtx): ReportResult {
  const { ds, window: w } = rc
  const groupBy = spec.dims.some((d) => d.value === rc.groupBy) || rc.groupBy === 'period' ? rc.groupBy : spec.defaultGroup
  const metric = spec.metrics.includes(rc.metric) ? rc.metric : spec.defaultMetric
  const granularity = rc.gran === 'auto' ? autoGranularity(w.days) : rc.gran
  const buckets = makeBuckets(new Date(w.from), new Date(w.to), granularity)
  const facts = spec.facts(ds, { from: w.from, to: w.to }, rc.toggles)
  const prevFacts = spec.facts(ds, { from: w.prevFrom, to: w.prevTo }, rc.toggles)
  const dd = spec.distinct
  const total = totalSums(facts, dd)
  const prevTotal = totalSums(prevFacts, dd)
  const mctx = { days: w.days }
  const c: Computed = { spec, buckets, granularity, facts, total }
  const rcx: RunCtx = { ...rc, groupBy, metric }

  const meas = (key: string): MeasureDef => {
    const m = spec.measures[key === '$metric' ? metric : key]
    if (!m) throw new Error(`Unknown measure ${key} in ${spec.slug}`)
    return m
  }
  const measureValue = (key: string, s: Sums) => num(meas(key).fn(s, mctx))

  // ---- bucket sums (for spark + trends) ----------------------------------
  let _buckets: Sums[] | null = null
  const perBucket = () => (_buckets ??= bucketSums(facts, buckets, dd))

  // ---- KPIs ----------------------------------------------------------------
  const kpis: KpiSpec[] = spec.kpis.map((k, i) => {
    if (k.custom) {
      return { key: k.key ?? `kpi${i}`, label: k.label ?? '', kind: k.kind ?? 'int', value: k.custom({ ds, window: w, total }), goodWhen: k.goodWhen, hint: k.hint, icon: k.icon }
    }
    const m = meas(k.measure!)
    return {
      key: k.measure!,
      label: k.label ?? m.label,
      kind: k.kind ?? m.kind,
      value: num(m.fn(total, mctx)),
      prev: prevFacts.length ? num(m.fn(prevTotal, mctx)) : null,
      goodWhen: k.goodWhen ?? m.goodWhen,
      hint: k.hint ?? m.hint,
      icon: k.icon,
      spark: k.spark ? perBucket().map((s) => num(m.fn(s, mctx)) ?? 0) : undefined,
    }
  })

  // ---- table ---------------------------------------------------------------
  const keyOfGroup = (dim: string): KeyFn =>
    dim === 'period'
      ? (f) => {
          const i = bucketIndex(buckets, f.t)
          return i >= 0 ? buckets[i]!.key : ''
        }
      : (f) => f.d[dim] ?? ''

  const colSpecs: { spec: ColSpec; measure?: MeasureDef; attr?: NonNullable<ReportSpec['attrs']>[string] }[] = []
  for (const ref of spec.columns) {
    const r = typeof ref === 'string' ? { key: ref } : ref
    if ('dims' in r && r.dims && !r.dims.includes(groupBy)) continue
    const m = spec.measures[r.key]
    const a = spec.attrs?.[r.key]
    if (m) colSpecs.push({ measure: m, spec: { key: r.key, label: m.label, kind: m.kind, size: ('size' in r ? r.size : undefined) ?? 110, tone: m.tone, bar: 'bar' in r ? r.bar : undefined, hint: m.hint, hideBelow: 'hideBelow' in r ? r.hideBelow : undefined } })
    else if (a) {
      if (a.dims && !a.dims.includes(groupBy)) continue
      colSpecs.push({ attr: a, spec: { key: r.key, label: a.label, kind: a.kind, size: ('size' in r ? r.size : undefined) ?? a.size ?? 120, status: a.status, tone: a.tone, hideBelow: 'hideBelow' in r ? r.hideBelow : undefined } })
    }
  }

  const dim = dimOf(spec, groupBy)
  const groups = aggregate(facts, keyOfGroup(groupBy), dd)
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]))
  const rows: ReportRow[] = []
  for (const [key, s] of groups) {
    if (groupBy === 'period' && !key) continue
    if (spec.keepRow && !spec.keepRow(s, key, groupBy)) continue
    const v: ReportRow['v'] = {}
    for (const col of colSpecs) {
      if (col.measure) v[col.spec.key] = (() => { const x = num(col.measure.fn(s, mctx)); return x === null ? null : round(x, 4) })()
      else v[col.spec.key] = col.attr!.fn(key, groupBy, { ds, window: w, s })
    }
    if (groupBy === 'period') {
      const b = bucketByKey.get(key)
      rows.push({ id: key, label: b?.title ?? key, sortKey: key, v })
    } else {
      const r = dim.resolve(ds, key)
      rows.push({ id: key || '__none', label: r.label, entity: r.entity, sub: r.sub, v })
    }
  }
  const totals: Record<string, number | string | null> = {}
  for (const col of colSpecs) totals[col.spec.key] = col.measure ? (() => { const x = num(col.measure.fn(total, mctx)); return x === null ? null : round(x, 4) })() : null
  const sort = spec.sort?.(groupBy, metric) ?? (groupBy === 'period' ? { id: '__group', desc: false } : { id: colSpecs.some((x) => x.spec.key === metric) ? metric : (colSpecs.find((x) => x.measure)?.spec.key ?? '__group'), desc: true })
  const table: TableSpec = {
    id: 'main',
    title: `By ${dim.label.toLowerCase()}`,
    groupLabel: dim.label,
    columns: colSpecs.map((x) => x.spec),
    rows,
    totals,
    defaultSort: sort,
    clickable: groupBy !== 'period',
  }

  // ---- charts --------------------------------------------------------------
  const charts: ChartSpec[] = []
  const rankDim = groupBy === 'period' ? spec.fallbackDim : groupBy
  const colorOf = (i: number) => PALETTE[i % PALETTE.length]!

  const build = (def: ChartDef): ChartSpec | null => {
    switch (def.type) {
      case 'trend': {
        const series: TrendSeriesSpec[] = def.series.map((s, i) => {
          const m = meas(s.measure)
          return { key: `s${i}`, label: s.label ?? m.label, type: s.type ?? 'area', axis: s.axis ?? 'left', color: s.color ?? colorOf(i), kind: m.kind, dashed: s.dashed }
        })
        const bs = perBucket()
        const data = buckets.map((b, bi) => {
          const row: Record<string, unknown> = { label: b.label, title: b.title }
          def.series.forEach((s, i) => {
            const x = measureValue(s.measure, bs[bi]!)
            row[`s${i}`] = x === null ? null : round(x, 2)
          })
          return row
        })
        return { id: def.id, type: 'trend', title: def.title, description: def.description, span: def.span ?? 2, data, series, stacked: def.stacked }
      }
      case 'trendBy': {
        const m = meas(def.measure)
        const dm = dimOf(spec, def.dim)
        const byKey = aggregate(facts, (f) => f.d[def.dim] ?? '', dd)
        const ranked = [...byKey.entries()].map(([k, s]) => ({ k, v: num(m.fn(s, mctx)) ?? 0 })).sort((a, b) => b.v - a.v)
        const limit = def.limit ?? 5
        const top = ranked.slice(0, limit).map((x) => x.k)
        const hasOther = ranked.length > limit
        const bucketKeyed = aggregate(facts, (f) => `${bucketIndex(buckets, f.t)}|${top.includes(f.d[def.dim] ?? '') ? (f.d[def.dim] ?? '') : '__other'}`, dd)
        const series: TrendSeriesSpec[] = [...top.map((k) => dm.resolve(ds, k).label), ...(hasOther ? ['Other'] : [])].map((label, i) => ({ key: `s${i}`, label, type: 'bar', axis: 'left', color: colorOf(i), kind: m.kind }))
        const keys = [...top, ...(hasOther ? ['__other'] : [])]
        const data = buckets.map((b, bi) => {
          const row: Record<string, unknown> = { label: b.label, title: b.title }
          keys.forEach((k, i) => {
            const s = bucketKeyed.get(`${bi}|${k}`)
            row[`s${i}`] = s ? round(num(m.fn(s, mctx)) ?? 0, 2) : 0
          })
          return row
        })
        return { id: def.id, type: 'trend', title: def.title, description: def.description, span: def.span ?? 2, data, series, stacked: true }
      }
      case 'ranking': {
        const key = def.measure ?? '$metric'
        const m = meas(key)
        const d = def.dim ? dimOf(spec, def.dim) : dimOf(spec, rankDim)
        const g = aggregate(facts, keyOfGroup(d.value), dd)
        const items = [...g.entries()]
          .map(([k, s]) => ({ k, s, v: num(m.fn(s, mctx)) }))
          .filter((x): x is { k: string; s: Sums; v: number } => x.v !== null)
          .sort((a, b) => b.v - a.v)
          .map((x) => {
            const r = d.resolve(ds, x.k)
            return { key: x.k || '__none', label: r.label, value: round(x.v, 2), sub: r.sub, entity: r.entity }
          })
        return { id: def.id, type: 'ranking', title: def.title, description: def.description ?? `${m.label} by ${d.label.toLowerCase()}`, span: def.span ?? 1, items, kind: m.kind, metricLabel: m.label, limit: def.limit ?? 8, goodWhen: m.goodWhen }
      }
      case 'share': {
        let data: { name: string; value: number; color?: string }[] = []
        let kind: ValueKind = 'int'
        if (def.slices) {
          data = def.slices.map((s, i) => ({ name: s.label, value: round(measureValue(s.measure, total) ?? 0, 2), color: s.color ?? colorOf(i) }))
          kind = meas(def.slices[0]!.measure).kind
        } else {
          const m = meas(def.measure ?? '$metric')
          kind = m.kind
          const d = def.dim ? dimOf(spec, def.dim) : dimOf(spec, rankDim)
          const g = aggregate(facts, keyOfGroup(d.value), dd)
          const all = [...g.entries()].map(([k, s]) => ({ name: d.resolve(ds, k).label, value: num(m.fn(s, mctx)) ?? 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
          const limit = def.limit ?? 6
          data = all.slice(0, limit).map((x, i) => ({ name: x.name, value: round(x.value, 2), color: colorOf(i) }))
          const rest = all.slice(limit).reduce((s, x) => s + x.value, 0)
          if (rest > 0) data.push({ name: 'Other', value: round(rest, 2), color: 'var(--chart-7)' })
        }
        data = data.filter((x) => x.value > 0)
        return { id: def.id, type: 'share', title: def.title, description: def.description, span: def.span ?? 1, data, kind, centerLabel: def.centerLabel }
      }
      case 'custom':
        return def.build(rcx, c)
    }
  }
  for (const def of spec.charts) {
    const ch = build(def)
    if (ch) charts.push(ch)
  }

  const details = spec.details ? spec.details(rcx, c) : []

  return {
    kpis, charts, table, details, factCount: facts.length, groupLabel: dim.label, metricLabel: meas('$metric').label, granularity,
  }
}
