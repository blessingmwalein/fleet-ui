import { Droplets, Fuel, Gauge, ShieldAlert, Tag, Wallet } from 'lucide-react'
import type { VehicleCategory } from '@/types'
import { completedTripFacts, DIM_BRANCH, DIM_CATEGORY, DIM_DRIVER, DIM_VEHICLE, inWin, PERIOD_DIM, ts, vehicleDims } from './common'
import { C, rt, sm } from './dsl'
import { fmtDateTimeLite } from './text'
import type { DimDef, Fact, ReportRow, ReportSpec, TableSpec } from './types'

/** Rated consumption (L/100 km) per vehicle category — used as the benchmark. */
const RATED: Record<VehicleCategory, number> = { heavy_truck: 38, tanker: 40, refrigerated: 24, bus: 30, light_truck: 18, delivery_van: 12, pickup: 11, service: 11, motorcycle: 3.5 }

const DIM_STATION: DimDef = {
  value: 'station', label: 'Station',
  resolve: (ds, k) => { const s = ds.stationById.get(k); return s ? { label: s.name, sub: s.city } : { label: 'Unknown station' } },
}
const DIM_BRAND: DimDef = { value: 'brand', label: 'Fuel brand', resolve: (_ds, k) => ({ label: k || 'Unknown' }) }
const DIM_FUELTYPE: DimDef = { value: 'fuelType', label: 'Fuel type', resolve: (_ds, k) => ({ label: k ? k.replace(/^\w/, (c) => c.toUpperCase()) : '—' }) }

export const fuelConsumption: ReportSpec = {
  slug: 'fuel-consumption',
  dims: [DIM_VEHICLE, DIM_CATEGORY, DIM_BRANCH, DIM_DRIVER, DIM_STATION, DIM_BRAND, DIM_FUELTYPE, PERIOD_DIM],
  defaultGroup: 'vehicle',
  fallbackDim: 'vehicle',
  metrics: ['spend', 'litres', 'l100', 'avgPrice', 'costPerKm', 'flagged'],
  defaultMetric: 'spend',
  measures: {
    litres: { label: 'Litres', kind: 'litres', fn: sm('litres'), hint: 'Fuel purchased (all fuel transactions in the period).' },
    spend: { label: 'Spend', kind: 'usd', fn: sm('spend'), goodWhen: 'down' },
    avgPrice: { label: 'Avg price / L', kind: 'usd2', fn: rt('spend', 'litres'), goodWhen: 'down' },
    tx: { label: 'Fills', kind: 'int', fn: sm('tx') },
    km: { label: 'Distance', kind: 'km', fn: sm('km'), hint: 'Distance on completed trips in the period.' },
    l100: { label: 'L / 100 km', kind: 'num1', fn: (s) => ((s.m.km ?? 0) > 0 && (s.m.litres ?? 0) > 0 ? ((s.m.litres ?? 0) / (s.m.km ?? 1)) * 100 : null), goodWhen: 'down', hint: 'Litres purchased ÷ km driven × 100 (blank where no distance is attributable).' },
    rated: { label: 'Rated L / 100 km', kind: 'num1', fn: (s) => ((s.m.bench ?? 0) > 0 ? ((s.m.bench ?? 0) / (s.m.km ?? 1)) * 100 : null), hint: 'Manufacturer-rated consumption for the vehicle mix.' },
    vsRated: { label: 'vs rated', kind: 'pct1', fn: (s) => ((s.m.bench ?? 0) > 0 && (s.m.litres ?? 0) > 0 ? (((s.m.litres ?? 0) - (s.m.bench ?? 0)) / (s.m.bench ?? 1)) * 100 : null), goodWhen: 'down', tone: { good: 10, warn: 25, invert: true }, hint: 'Actual litres vs rated consumption for the distance driven.' },
    costPerKm: { label: 'Fuel cost / km', kind: 'usd2', fn: (s) => ((s.m.km ?? 0) > 0 && (s.m.spend ?? 0) > 0 ? (s.m.spend ?? 0) / (s.m.km ?? 1) : null), goodWhen: 'down' },
    flagged: { label: 'Flagged', kind: 'int', fn: sm('flagged'), goodWhen: 'down', hint: 'Transactions flagged by anomaly rules (over tank capacity, odd hours, duplicates…).' },
    flaggedSpend: { label: 'Flagged spend', kind: 'usd', fn: sm('flaggedSpend'), goodWhen: 'down' },
    flaggedPct: { label: 'Flagged %', kind: 'pct1', fn: rt('flagged', 'tx', 100), goodWhen: 'down', tone: { good: 1, warn: 4, invert: true } },
  },
  attrs: {
    scity: { label: 'City', kind: 'text', dims: ['station'], size: 110, fn: (k, _d, x) => x.ds.stationById.get(k)?.city ?? null },
  },
  columns: ['scity', { key: 'spend', bar: true, size: 130 }, 'litres', 'avgPrice', 'tx', 'km', 'l100', 'rated', 'vsRated', 'costPerKm', 'flagged', 'flaggedSpend'],
  kpis: [
    { measure: 'spend', icon: Wallet, label: 'Fuel spend', spark: true },
    { measure: 'litres', icon: Droplets, spark: true },
    { measure: 'avgPrice', icon: Tag, spark: true },
    { measure: 'l100', icon: Gauge, label: 'Fleet L / 100 km' },
    { measure: 'costPerKm', icon: Fuel },
    { measure: 'flagged', icon: ShieldAlert, label: 'Flagged fills' },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Fuel purchased and spend', description: 'Litres per period with spend on the right axis', span: 2,
      series: [{ measure: 'litres', type: 'bar', color: C.green }, { measure: 'spend', type: 'line', axis: 'right', color: C.amber }],
    },
    { id: 'rank', type: 'ranking', title: 'Fuel ranking' },
    { id: 'share', type: 'share', title: 'Spend by fuel brand', dim: 'brand', measure: 'spend', centerLabel: 'fuel spend' },
    {
      id: 'eff', type: 'trend', title: 'Price and efficiency', description: 'Average price per litre and fleet L / 100 km', span: 2,
      series: [{ measure: 'avgPrice', type: 'line', color: C.blue }, { measure: 'l100', type: 'line', axis: 'right', color: C.green }],
    },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const f of ds.fuel) {
      const t = ts(f.date)
      if (!inWin(t, w)) continue
      const st = ds.stationById.get(f.stationId)
      out.push({
        t,
        d: { ...vehicleDims(ds, f.vehicleId), branch: f.branchId, driver: f.driverId ?? '', station: f.stationId, brand: st?.brand ?? '', fuelType: f.fuelType },
        m: { litres: f.litres, spend: f.totalUsd, tx: 1, flagged: f.flag ? 1 : 0, flaggedSpend: f.flag ? f.totalUsd : 0 },
      })
    }
    for (const f of completedTripFacts(ds, w)) {
      const cat = f.d.category as VehicleCategory
      out.push({ t: f.t, d: { vehicle: f.d.vehicle!, category: f.d.category!, branch: f.d.branch!, driver: f.d.driver! }, m: { km: f.m.km!, bench: ((f.m.km ?? 0) * (RATED[cat] ?? 0)) / 100 } })
    }
    return out
  },
  details: ({ ds, window: w }) => {
    const rows: ReportRow[] = ds.fuel
      .filter((f) => f.flag && inWin(ts(f.date), w))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((f) => ({
        id: f.id,
        label: f.ref,
        entity: { type: 'fuel' as const, id: f.id },
        v: {
          date: fmtDateTimeLite(f.date),
          vehicle: ds.vehicleById.get(f.vehicleId)?.reg ?? '—',
          driver: f.driverId ? (ds.driverById.get(f.driverId)?.name ?? '—') : '—',
          station: ds.stationById.get(f.stationId)?.name ?? '—',
          litres: f.litres,
          total: f.totalUsd,
          severity: f.flag!.severity,
          reason: f.flag!.reason,
        },
      }))
    const t: TableSpec = {
      id: 'anomalies', title: 'Flagged fuel transactions', description: 'Anomalies detected by the fuel rules in the period — review in Fuel › Reconciliation', groupLabel: 'Transaction', clickable: true,
      columns: [
        { key: 'date', label: 'Date', kind: 'text', size: 140 }, { key: 'vehicle', label: 'Vehicle', kind: 'text', size: 100 }, { key: 'driver', label: 'Driver', kind: 'text', size: 150, hideBelow: 'md' },
        { key: 'station', label: 'Station', kind: 'text', size: 170, hideBelow: 'lg' }, { key: 'litres', label: 'Litres', kind: 'litres', size: 90 }, { key: 'total', label: 'Total', kind: 'usd2', size: 90 },
        { key: 'severity', label: 'Severity', kind: 'text', size: 90 }, { key: 'reason', label: 'Reason', kind: 'text', size: 360, hideBelow: 'xl' },
      ],
      rows,
      defaultSort: { id: 'date', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'Fuel figures include every fuel transaction (card and cash) in the period; efficiency divides litres by the km of completed trips in the same period.',
    'Rated consumption uses the typical L/100 km for each vehicle category; “vs rated” shows how far actual litres are above (+) or below (−) that benchmark.',
    'Flagged transactions are those caught by anomaly rules: litres above tank capacity, fills outside operating hours, possible duplicates, odometer mismatches and abnormal consumption.',
  ],
}
