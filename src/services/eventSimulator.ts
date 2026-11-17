import type { IncidentType } from '@/types'
import { db } from '@/store/db'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { createRng } from '@/lib/rng'
import { describeLocation } from '@/data/places'
import { titleCase } from '@/lib/format'
import { eventBus, type EventSource } from './events'

/**
 * Simulated operational events that are not a direct by-product of vehicle movement:
 * expiring licences/documents, overdue maintenance and newly reported incidents.
 * Replace with a real `EventSource` (WebSocket/SSE) that publishes the same `LiveEvent` payloads.
 */
export class SimulatedEventSource implements EventSource {
  readonly name = 'simulated'
  private timer: ReturnType<typeof setTimeout> | undefined
  private fired = new Set<string>()
  private rng = createRng(Date.now() & 0xffffff)
  private running = false

  start() {
    if (this.running) return
    this.running = true
    this.scheduleNext(9000)
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
  }

  private scheduleNext(ms?: number) {
    clearTimeout(this.timer)
    if (!this.running) return
    this.timer = setTimeout(() => {
      try {
        if (useSettings.getState().simulation.events) this.emitOne()
      } finally {
        this.scheduleNext()
      }
    }, ms ?? this.rng.int(22_000, 48_000))
  }

  private once(key: string) {
    if (this.fired.has(key)) return false
    this.fired.add(key)
    return true
  }

  private emitOne() {
    const r = this.rng
    const roll = r.next()
    const { drivers, vehicles, schedules, documents } = db()
    const now = Date.now()
    const warnMs = useSettings.getState().thresholds.docExpiryWarnDays * 864e5

    if (roll < 0.28) {
      const d = drivers.filter((x) => {
        const t = new Date(x.licenceExpiry).getTime()
        return t > now && t < now + warnMs && !this.fired.has(`lic-${x.id}`)
      })
      const pick = d.length ? r.pick(d) : null
      if (pick && this.once(`lic-${pick.id}`)) {
        const days = Math.ceil((new Date(pick.licenceExpiry).getTime() - now) / 864e5)
        eventBus.publish({ type: 'licence_expiring', severity: days <= 14 ? 'critical' : 'warning', title: 'Driver licence expiring', message: `${pick.name}'s licence expires in ${days} day${days === 1 ? '' : 's'}.`, entity: { type: 'driver', id: pick.id } })
        return
      }
    }
    if (roll < 0.5) {
      const overdue = schedules.filter((s) => new Date(s.nextDueDate).getTime() < now && !this.fired.has(`mnt-${s.id}`))
      const pick = overdue.length ? r.pick(overdue) : null
      const veh = pick && vehicles.find((v) => v.id === pick.vehicleId)
      if (pick && veh && this.once(`mnt-${pick.id}`)) {
        const days = Math.max(1, Math.round((now - new Date(pick.nextDueDate).getTime()) / 864e5))
        eventBus.publish({ type: 'maintenance_overdue', severity: 'warning', title: `Service overdue: ${veh.reg}`, message: `${pick.task} is ${days} day${days === 1 ? '' : 's'} past due.`, entity: { type: 'vehicle', id: veh.id } })
        return
      }
    }
    if (roll < 0.66) {
      const exp = documents.filter((x) => {
        const t = new Date(x.expiryDate).getTime()
        return x.entityType === 'vehicle' && t > now && t < now + warnMs && !this.fired.has(`doc-${x.id}`)
      })
      const pick = exp.length ? r.pick(exp) : null
      const veh = pick && vehicles.find((v) => v.id === pick.entityId)
      if (pick && veh && this.once(`doc-${pick.id}`)) {
        const days = Math.ceil((new Date(pick.expiryDate).getTime() - now) / 864e5)
        eventBus.publish({ type: 'document_expiring', severity: days <= 14 ? 'critical' : 'warning', title: `${titleCase(pick.type)} expiring`, message: `${veh.reg}: expires in ${days} day${days === 1 ? '' : 's'}.`, entity: { type: 'vehicle', id: veh.id } })
        return
      }
    }
    // new incident on a moving vehicle (rare)
    if (r.chance(0.22)) this.raiseIncident()
  }

  raiseIncident() {
    const r = this.rng
    const telemetry = useLive.getState().telemetry
    const moving = Object.values(telemetry).filter((t) => t.state === 'moving' && t.tripId)
    if (!moving.length) return
    const t = r.pick(moving)
    const v = db().vehicles.find((x) => x.id === t.vehicleId)
    if (!v) return
    const type = r.weighted<IncidentType>([['breakdown', 5], ['near_miss', 3], ['cargo_damage', 2], ['collision', 2], ['other', 1]])
    const severity = type === 'collision' ? r.pick(['minor', 'moderate'] as const) : type === 'near_miss' ? 'minor' : r.pick(['minor', 'moderate'] as const)
    const copy: Record<string, string> = {
      breakdown: 'Mechanical fault reported by driver; vehicle pulled over safely.',
      near_miss: 'Driver reported a near miss with an oncoming vehicle.',
      cargo_damage: 'Load shifted under braking; possible cargo damage.',
      collision: 'Minor collision reported — no injuries.',
      other: 'Roadside incident reported by driver.',
    }
    const year = new Date().getFullYear()
    const n = db().incidents.length + 1
    const created = db().insert(
      'incidents',
      {
        ref: `INC-${year}-${String(n).padStart(3, '0')}`,
        type,
        severity,
        status: 'reported',
        vehicleId: v.id,
        driverId: v.driverId,
        tripId: t.tripId,
        branchId: v.branchId,
        date: new Date().toISOString(),
        location: describeLocation(t),
        lat: t.lat,
        lng: t.lng,
        description: copy[type]!,
        injuries: 0,
        thirdPartyInvolved: type === 'collision' || type === 'near_miss',
        estCostUsd: severity === 'minor' ? r.int(80, 500) : r.int(600, 3500),
        insuranceClaim: false,
        reportedBy: db().drivers.find((d) => d.id === v.driverId)?.name ?? 'Driver',
      },
      { summary: `Incident reported for ${v.reg} (live)` },
    )
    eventBus.publish({ type: 'incident_reported', severity: severity === 'minor' ? 'warning' : 'critical', title: `New incident ${created.ref}`, message: `${v.reg}: ${copy[type]}`, entity: { type: 'incident', id: created.id } })
  }
}

export const eventSource = new SimulatedEventSource()
