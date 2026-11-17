import { AlertOctagon, CalendarCheck, Banknote, Gauge, ShieldAlert, Siren } from 'lucide-react'
import { INCIDENT_SEVERITY, INCIDENT_STATUS, INCIDENT_TYPE, SAFETY_EVENT_TYPE } from '@/config/status'
import { completedTripFacts, DAY, DIM_BRANCH, DIM_DRIVER, DIM_VEHICLE, inWin, PERIOD_DIM, ts, vehicleDims } from './common'
import { C, rt, sm } from './dsl'
import { fmtDateTimeLite } from './text'
import type { DimDef, Fact, ReportRow, ReportSpec, TableSpec } from './types'

const DIM_ITYPE: DimDef = { value: 'incidentType', label: 'Incident type', resolve: (_ds, k) => ({ label: INCIDENT_TYPE[k as keyof typeof INCIDENT_TYPE] ?? k }) }
const DIM_ETYPE: DimDef = { value: 'eventType', label: 'Safety event type', resolve: (_ds, k) => ({ label: SAFETY_EVENT_TYPE[k as keyof typeof SAFETY_EVENT_TYPE] ?? k }) }
const DIM_SEV: DimDef = { value: 'incSeverity', label: 'Incident severity', resolve: (_ds, k) => ({ label: INCIDENT_SEVERITY[k]?.label ?? k }) }

export const safetyIncidents: ReportSpec = {
  slug: 'safety-incidents',
  dims: [DIM_DRIVER, DIM_VEHICLE, DIM_BRANCH, DIM_ITYPE, DIM_ETYPE, DIM_SEV, PERIOD_DIM],
  defaultGroup: 'driver',
  fallbackDim: 'driver',
  metrics: ['incidents', 'events', 'loss', 'evRate', 'incRate', 'major'],
  defaultMetric: 'events',
  measures: {
    incidents: { label: 'Incidents', kind: 'int', fn: sm('incidents'), goodWhen: 'down', hint: 'Reported accidents, breakdowns, thefts and near misses.' },
    major: { label: 'Major / critical', kind: 'int', fn: sm('major'), goodWhen: 'down' },
    injuries: { label: 'Injuries', kind: 'int', fn: sm('injuries'), goodWhen: 'down' },
    loss: { label: 'Est. loss', kind: 'usd', fn: sm('loss'), goodWhen: 'down', hint: 'Estimated cost of incidents.' },
    claims: { label: 'Insurance claims', kind: 'int', fn: sm('claims') },
    openInc: { label: 'Open', kind: 'int', fn: sm('openInc'), goodWhen: 'down', hint: 'Incidents still reported or under investigation.' },
    events: { label: 'Safety events', kind: 'int', fn: sm('events'), goodWhen: 'down', hint: 'Telematics events: harsh braking/acceleration/cornering, speeding, fatigue, seatbelt, phone use, idling.' },
    highEvents: { label: 'High severity', kind: 'int', fn: sm('highEvents'), goodWhen: 'down' },
    unreviewed: { label: 'Unreviewed', kind: 'int', fn: sm('unreviewed'), goodWhen: 'down', hint: 'Events not yet reviewed by a supervisor.' },
    km: { label: 'Distance', kind: 'km', fn: sm('km') },
    evRate: { label: 'Events / 1,000 km', kind: 'num2', fn: (s) => ((s.m.km ?? 0) > 0 ? ((s.m.events ?? 0) / (s.m.km ?? 1)) * 1000 : null), goodWhen: 'down', tone: { good: 2, warn: 5, invert: true } },
    incRate: { label: 'Incidents / 100k km', kind: 'num2', fn: (s) => ((s.m.km ?? 0) > 0 ? ((s.m.incidents ?? 0) / (s.m.km ?? 1)) * 1e5 : null), goodWhen: 'down', tone: { good: 10, warn: 25, invert: true } },
    avgLoss: { label: 'Avg loss / incident', kind: 'usd', fn: rt('loss', 'incidents') },
  },
  attrs: {
    score: { label: 'Safety score', kind: 'num1', dims: ['driver'], size: 110, tone: { good: 85, warn: 70 }, fn: (k, _d, x) => x.ds.driverById.get(k)?.safetyScore ?? null },
    vstatus: { label: 'Status', kind: 'text', status: 'vehicle', dims: ['vehicle'], size: 120, fn: (k, _d, x) => x.ds.vehicleById.get(k)?.status ?? null },
  },
  columns: ['score', 'vstatus', { key: 'events', bar: true, size: 130 }, 'highEvents', 'unreviewed', 'evRate', 'incidents', 'major', 'injuries', 'openInc', 'claims', 'loss', 'avgLoss', 'km', 'incRate'],
  kpis: [
    { measure: 'incidents', icon: Siren, spark: true },
    { measure: 'events', icon: ShieldAlert, spark: true },
    { measure: 'evRate', icon: Gauge, spark: true },
    { measure: 'loss', icon: Banknote, spark: true },
    { measure: 'openInc', icon: AlertOctagon, label: 'Open incidents' },
    {
      key: 'since', label: 'Days since major incident', kind: 'int', icon: CalendarCheck, goodWhen: 'up', hint: 'Days since the last major or critical incident (as at the end of the period).',
      custom: ({ ds, window: w }) => {
        const end = Math.min(w.to, ds.now)
        let last = 0
        for (const i of ds.incidents) {
          const t = Date.parse(i.date)
          if ((i.severity === 'major' || i.severity === 'critical') && t <= end && t > last) last = t
        }
        return last ? Math.floor((end - last) / DAY) : null
      },
    },
  ],
  charts: [
    {
      id: 'trend', type: 'trend', title: 'Incidents and safety events', description: 'Incidents per period (bars) with telematics events on the right axis', span: 2,
      series: [{ measure: 'incidents', type: 'bar', color: C.red }, { measure: 'events', type: 'line', axis: 'right', color: C.amber }],
    },
    { id: 'rank', type: 'ranking', title: 'Risk ranking' },
    { id: 'share', type: 'share', title: 'Incidents by type', dim: 'incidentType', measure: 'incidents', centerLabel: 'incidents' },
    { id: 'evtype', type: 'trendBy', title: 'Safety events by type', description: 'Stacked per period', dim: 'eventType', measure: 'events', limit: 5, span: 2 },
  ],
  facts: (ds, w) => {
    const out: Fact[] = []
    for (const i of ds.incidents) {
      const t = ts(i.date)
      if (!inWin(t, w)) continue
      out.push({
        t,
        d: { ...vehicleDims(ds, i.vehicleId), branch: i.branchId, driver: i.driverId ?? '', incidentType: i.type, incSeverity: i.severity },
        m: {
          incidents: 1, injuries: i.injuries, loss: i.estCostUsd, claims: i.insuranceClaim ? 1 : 0,
          openInc: i.status === 'reported' || i.status === 'investigating' ? 1 : 0, major: i.severity === 'major' || i.severity === 'critical' ? 1 : 0,
        },
      })
    }
    for (const e of ds.events) {
      const t = ts(e.timestamp)
      if (!inWin(t, w)) continue
      out.push({
        t,
        d: { ...vehicleDims(ds, e.vehicleId), branch: e.branchId, driver: e.driverId ?? '', eventType: e.type },
        m: { events: 1, highEvents: e.severity === 'high' ? 1 : 0, unreviewed: e.reviewed ? 0 : 1 },
      })
    }
    for (const f of completedTripFacts(ds, w)) out.push({ t: f.t, d: { vehicle: f.d.vehicle!, category: f.d.category!, branch: f.d.branch!, driver: f.d.driver! }, m: { km: f.m.km! } })
    return out
  },
  keepRow: (s, key, g) => (g === 'incidentType' || g === 'incSeverity' ? (s.m.incidents ?? 0) > 0 : g === 'eventType' ? (s.m.events ?? 0) > 0 : !!key || g === 'period'),
  details: ({ ds, window: w }) => {
    const rows: ReportRow[] = ds.incidents
      .filter((i) => inWin(ts(i.date), w))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15)
      .map((i) => ({
        id: i.id,
        label: i.ref,
        entity: { type: 'incident' as const, id: i.id },
        v: {
          date: fmtDateTimeLite(i.date), type: INCIDENT_TYPE[i.type], severity: INCIDENT_SEVERITY[i.severity]?.label ?? i.severity, vehicle: ds.vehicleById.get(i.vehicleId)?.reg ?? '—',
          driver: i.driverId ? (ds.driverById.get(i.driverId)?.name ?? '—') : '—', location: i.location, injuries: i.injuries, loss: i.estCostUsd, status: INCIDENT_STATUS[i.status]?.label ?? i.status,
        },
      }))
    const t: TableSpec = {
      id: 'register', title: 'Incident register', description: 'Latest 15 incidents in the period', groupLabel: 'Incident', clickable: true,
      columns: [
        { key: 'date', label: 'Date', kind: 'text', size: 140 }, { key: 'type', label: 'Type', kind: 'text', size: 110 }, { key: 'severity', label: 'Severity', kind: 'text', size: 90 },
        { key: 'vehicle', label: 'Vehicle', kind: 'text', size: 100 }, { key: 'driver', label: 'Driver', kind: 'text', size: 150, hideBelow: 'md' }, { key: 'location', label: 'Location', kind: 'text', size: 260, hideBelow: 'xl' },
        { key: 'injuries', label: 'Injuries', kind: 'int', size: 80 }, { key: 'loss', label: 'Est. loss', kind: 'usd', size: 90 }, { key: 'status', label: 'Status', kind: 'text', size: 110 },
      ],
      rows,
      defaultSort: { id: 'date', desc: true },
    }
    return rows.length ? [t] : []
  },
  definitions: [
    'Incidents are reported events (collision, breakdown, theft, near miss…); safety events are telematics detections such as harsh braking, speeding and fatigue.',
    'Event and incident rates are normalised by km driven on completed trips in the same period so drivers and depots of different sizes can be compared.',
    'Estimated loss is the estimated cost recorded on each incident; open = reported or under investigation.',
  ],
}
