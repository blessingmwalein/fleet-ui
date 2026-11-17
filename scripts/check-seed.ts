// Sanity-checks the generated demo dataset: counts + referential integrity.
// Run: npx tsx scripts/check-seed.ts
import { buildSeed } from '../src/data/seed/index.ts'

const { data, notifications } = buildSeed(Date.now())
const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length]))
console.log(counts, 'notifications', notifications.length)

const ids = (k: keyof typeof data) => new Set((data[k] as { id: string }[]).map((x) => x.id))
const vehicleIds = ids('vehicles')
const driverIds = ids('drivers')
const customerIds = ids('customers')
const tripIds = ids('trips')
let bad = 0
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    bad++
    if (bad < 25) console.log('INTEGRITY:', msg)
  }
}
for (const t of data.trips) {
  check(!t.vehicleId || vehicleIds.has(t.vehicleId), `trip ${t.id} vehicle`)
  check(!t.driverId || driverIds.has(t.driverId), `trip ${t.id} driver`)
  check(!t.customerId || customerIds.has(t.customerId), `trip ${t.id} customer`)
}
for (const f of data.fuelTransactions) check(vehicleIds.has(f.vehicleId) && (!f.tripId || tripIds.has(f.tripId)), `fuel ${f.id}`)
for (const e of data.expenses) check((!e.vehicleId || vehicleIds.has(e.vehicleId)) && (!e.tripId || tripIds.has(e.tripId)), `expense ${e.id}`)
for (const s of data.shipments) check(customerIds.has(s.customerId) && (!s.tripId || tripIds.has(s.tripId)), `shipment ${s.id}`)
for (const w of data.workOrders) check(vehicleIds.has(w.vehicleId), `wo ${w.id}`)
for (const i of data.incidents) check(vehicleIds.has(i.vehicleId), `incident ${i.id}`)
for (const v of data.vehicles) check(!v.driverId || driverIds.has(v.driverId), `vehicle ${v.id}`)
console.log('integrity problems:', bad)

const byStatus: Record<string, number> = {}
for (const t of data.trips) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
console.log('trips by status', byStatus)
const vs: Record<string, number> = {}
for (const v of data.vehicles) vs[v.status + '/' + v.category] = (vs[v.status + '/' + v.category] ?? 0) + 1
console.log('vehicles', vs)
console.log('json size KB', Math.round(JSON.stringify(data).length / 1024))
const sizes = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Math.round(JSON.stringify(v).length / 1024)]))
console.log('KB by collection', sizes)
const inv: Record<string, number> = {}
for (const i of data.invoices) inv[i.kind + '/' + i.status] = (inv[i.kind + '/' + i.status] ?? 0) + 1
console.log('invoices', inv)
console.log('sample trip', JSON.stringify(data.trips.find((t) => t.status === 'in_transit'), null, 1).slice(0, 1200))
const rev = data.trips.filter((t) => t.status === 'completed').reduce((s, t) => s + t.revenueUsd, 0)
const fuel = data.fuelTransactions.reduce((s, t) => s + t.totalUsd, 0)
const exp = data.expenses.reduce((s, t) => s + t.amountUsd, 0)
const maint = data.workOrders.filter((w) => w.status === 'completed').reduce((s, w) => s + w.labourCostUsd + w.partsCostUsd, 0)
console.log({ revenue: Math.round(rev), fuel: Math.round(fuel), expenses: Math.round(exp), maintenance: Math.round(maint) })
