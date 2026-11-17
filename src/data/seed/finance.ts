import type { AppNotification, AuditEntry, Budget, Customer, Expense, ExpenseCategory, FuelTransaction, Incident, Invoice, Trip, User, WorkOrder } from '@/types'
import { createRng } from '@/lib/rng'
import { ROUTE_BY_ID } from '../routes'
import { FUEL_STATIONS } from './support'
import type { FleetSeed } from './fleet'
import { CURRENT_USER_ID } from './org'

const DAY = 864e5

export interface FinanceSeed {
  expenses: Expense[]
  invoices: Invoice[]
  budgets: Budget[]
}

const monthKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function buildFinance(now: number, fleet: FleetSeed, trips: Trip[], fuel: FuelTransaction[], workOrders: WorkOrder[], customers: Customer[]): FinanceSeed {
  const rng = createRng(8080)
  const iso = (t: number) => new Date(t).toISOString()
  const vehicleById = new Map(fleet.vehicles.map((v) => [v.id, v]))
  const driverById = new Map(fleet.drivers.map((d) => [d.id, d]))
  const expenses: Expense[] = []

  const add = (e: Omit<Expense, 'id' | 'ref' | 'status' | 'approvedBy' | 'rejectionReason'> & { status?: Expense['status'] }) => {
    const age = (now - new Date(e.date).getTime()) / DAY
    let status = e.status
    let rejectionReason: string | undefined
    if (!status) {
      status = age > 12 ? rng.weighted([['paid', 8], ['approved', 1], ['rejected', 0.3]] as const) : age > 3 ? rng.weighted([['approved', 5], ['paid', 2], ['pending', 3], ['rejected', 0.4]] as const) : rng.weighted([['pending', 6], ['approved', 3]] as const)
    }
    if (status === 'rejected') rejectionReason = rng.pick(['No receipt attached', 'Amount exceeds policy limit', 'Duplicate claim', 'Not a business expense'])
    expenses.push({ ...e, id: '', ref: '', status, approvedBy: status === 'approved' || status === 'paid' ? rng.pick(['Memory Chitiyo', 'Rudo Chigwedere']) : undefined, rejectionReason })
  }

  for (const t of trips) {
    if (!t.vehicleId || !['completed', 'in_transit', 'delayed'].includes(t.status)) continue
    const v = vehicleById.get(t.vehicleId)!
    const d = t.driverId ? driverById.get(t.driverId) : undefined
    const route = ROUTE_BY_ID[t.routeId]!
    const when = new Date(t.actualStart ?? t.scheduledStart).getTime() + rng.int(0, 90) * 6e4
    const base = { vehicleId: v.id, tripId: t.id, driverId: t.driverId, branchId: t.branchId, submittedBy: d?.name ?? 'Dispatcher' }
    const heavy = ['heavy_truck', 'tanker', 'bus', 'refrigerated'].includes(v.category)
    if (rng.chance(t.status === 'completed' ? 0.62 : 0.9)) {
      const allowance = Math.round(12 + t.plannedDistanceKm * 0.09 + (t.plannedDistanceKm > 300 ? 25 : 0))
      add({ ...base, category: 'allowance', description: `Driver trip allowance – ${t.origin.city} to ${t.destination.city}`, amountUsd: allowance, date: iso(when), supplier: 'Payroll', paymentMethod: 'ecocash' })
    }
    if (route.kind === 'highway' && t.status === 'completed' && rng.chance(0.62)) {
      const toll = Math.round((heavy ? 3.5 : 1.8) * (route.lengthM / 1000 / 45) * 10) / 10
      add({ ...base, category: 'toll', description: `Toll fees – ${route.road.split(' ')[0]} (${t.origin.city}–${t.destination.city})`, amountUsd: toll, date: iso(when + 36e5), supplier: 'ZINARA Toll', paymentMethod: 'cash', receiptNo: `TL${rng.int(100000, 999999)}` })
    }
    if (route.id.includes('BBR') && t.status === 'completed' && rng.chance(0.7)) {
      add({ ...base, category: 'other', description: 'Border & council fees – Beitbridge', amountUsd: rng.int(45, 140), date: iso(when + 5 * 36e5), supplier: 'ZIMRA / Beitbridge Rural DC', paymentMethod: 'cash', receiptNo: `BF${rng.int(10000, 99999)}` })
    }
    if (t.status === 'completed' && rng.chance(0.025)) {
      add({ ...base, category: 'fines', description: 'Traffic fine – overloading / expired disc', amountUsd: rng.pick([20, 30, 50, 75, 100]), date: iso(when + 2 * 36e5), supplier: 'ZRP', paymentMethod: 'cash' })
    }
    if (route.kind === 'city' && rng.chance(0.1)) {
      add({ ...base, category: 'parking', description: 'Parking & loading bay fees', amountUsd: rng.int(2, 12), date: iso(when), supplier: 'City Council', paymentMethod: 'cash' })
    }
  }

  // overhead items – insurance, licensing, tyres, a few fuel cash claims
  for (let m = 0; m < 5; m++) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - m, 3)
    add({ category: 'insurance', description: `Fleet insurance premium – ${d.toLocaleString('en-US', { month: 'long' })}`, amountUsd: rng.int(6800, 7600), date: iso(d.getTime()), vehicleId: null, tripId: null, driverId: null, branchId: 'br-hre', supplier: 'Old Mutual Insurance', paymentMethod: 'bank_transfer', submittedBy: 'Memory Chitiyo', status: m === 0 ? 'approved' : 'paid' })
  }
  for (let i = 0; i < 8; i++) {
    const v = rng.pick(fleet.vehicles)
    add({ category: 'licensing', description: 'ZINARA vehicle licence & radio licence renewal', amountUsd: rng.int(80, 420), date: iso(now - rng.int(2, 110) * DAY), vehicleId: v.id, tripId: null, driverId: null, branchId: v.branchId, supplier: 'ZINARA', paymentMethod: 'bank_transfer', submittedBy: 'Fleet Admin' })
  }
  for (let i = 0; i < 12; i++) {
    const v = rng.pick(fleet.vehicles)
    add({ category: 'tyres', description: `Tyre purchase – ${rng.pick(['2 × 315/80R22.5', '4 × 195R15C', '1 × 315/80R22.5', '2 × 265/65R17'])}`, amountUsd: rng.int(180, 1650), date: iso(now - rng.int(1, 115) * DAY), vehicleId: v.id, tripId: null, driverId: null, branchId: v.branchId, supplier: 'Premier Tyre & Rubber', paymentMethod: 'bank_transfer', submittedBy: 'Cosmas Bvuma' })
  }
  for (let i = 0; i < 10; i++) {
    const v = rng.pick(fleet.vehicles.filter((x) => x.category !== 'heavy_truck'))
    add({ category: 'fuel', description: 'Cash fuel purchase – card machine offline', amountUsd: rng.int(30, 140), date: iso(now - rng.int(0, 90) * DAY), vehicleId: v.id, tripId: null, driverId: v.driverId, branchId: v.branchId, supplier: 'Roadside Fuels', paymentMethod: 'cash', submittedBy: driverById.get(v.driverId ?? '')?.name ?? 'Driver' })
  }

  expenses.sort((a, b) => a.date.localeCompare(b.date))
  expenses.forEach((e, i) => {
    e.id = `exp-${String(i + 1).padStart(4, '0')}`
    e.ref = `EXP-${String(7000 + i)}`
    e.receiptNo = e.receiptNo ?? (rng.chance(0.8) ? `RC${rng.int(100000, 999999)}` : undefined)
  })

  // trip.expensesUsd = linked expenses + linked fuel
  const tripExp = new Map<string, number>()
  for (const e of expenses) if (e.tripId) tripExp.set(e.tripId, (tripExp.get(e.tripId) ?? 0) + e.amountUsd)
  for (const f of fuel) if (f.tripId) tripExp.set(f.tripId, (tripExp.get(f.tripId) ?? 0) + f.totalUsd)
  for (const t of trips) t.expensesUsd = Math.round((tripExp.get(t.id) ?? 0) * 100) / 100

  // ---- invoices ------------------------------------------------------------
  const invoices: Invoice[] = []
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const groups = new Map<string, Trip[]>()
  for (const t of trips) {
    if (t.status !== 'completed' || !t.customerId || t.revenueUsd <= 0) continue
    const key = `${t.customerId}|${monthKey(new Date(t.actualEnd!).getTime())}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const draftsInvoices: Invoice[] = []
  for (const [key, ts] of groups) {
    const [cid, mk] = key.split('|') as [string, string]
    const c = customerById.get(cid)!
    const [y, m] = mk.split('-').map(Number) as [number, number]
    const monthEnd = new Date(y, m, 0, 17, 0).getTime()
    const issue = Math.min(monthEnd, now - DAY)
    const due = issue + c.paymentTermsDays * DAY
    const amount = Math.round(ts.reduce((s, t) => s + t.revenueUsd, 0))
    let status: Invoice['status']
    let paid = 0
    const payments: Invoice['payments'] = []
    if (issue > now - 3 * DAY && mk === monthKey(now)) status = rng.chance(0.4) ? 'draft' : 'sent'
    else if (due < now) {
      const x = rng.next()
      status = x < 0.62 ? 'paid' : x < 0.74 ? 'partial' : 'overdue'
    } else status = rng.chance(0.25) ? 'partial' : rng.chance(0.2) ? 'paid' : 'sent'
    if (status === 'paid') paid = amount
    else if (status === 'partial') paid = Math.round(amount * rng.float(0.3, 0.7))
    if (paid > 0) {
      const when = Math.min(now - DAY, issue + rng.int(7, Math.max(8, c.paymentTermsDays)) * DAY)
      payments.push({ date: iso(when), amountUsd: paid, method: rng.pick(['Bank transfer', 'RTGS', 'EcoCash Business']), ref: `PAY-${rng.int(100000, 999999)}` })
    }
    if (status === 'sent' && due < now) status = 'overdue'
    const inv: Invoice = {
      id: '',
      number: '',
      kind: 'customer',
      partyId: c.id,
      partyName: c.name,
      description: `Freight services – ${ts.length} trip${ts.length === 1 ? '' : 's'} (${new Date(y, m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })})`,
      amountUsd: amount,
      paidUsd: paid,
      issueDate: iso(issue),
      dueDate: iso(due),
      status,
      tripIds: ts.map((t) => t.id),
      branchId: 'br-hre',
      payments,
    }
    draftsInvoices.push(inv)
  }
  invoices.push(...draftsInvoices)

  // supplier invoices — fuel by brand/month, workshop by provider/month, insurance
  const stationBrand = new Map(FUEL_STATIONS.map((s) => [s.id, s.brand]))
  const fuelGroups = new Map<string, number>()
  for (const f of fuel) {
    const brand = stationBrand.get(f.stationId)!
    if (brand === 'Independent') continue
    const k = `${brand}|${monthKey(new Date(f.date).getTime())}`
    fuelGroups.set(k, (fuelGroups.get(k) ?? 0) + f.totalUsd)
  }
  const supplierStatus = (due: number): { status: Invoice['status']; paidFrac: number } => {
    if (due < now - 5 * DAY) return rng.chance(0.88) ? { status: 'paid', paidFrac: 1 } : { status: 'overdue', paidFrac: 0 }
    if (due < now) return rng.chance(0.5) ? { status: 'paid', paidFrac: 1 } : { status: 'overdue', paidFrac: 0 }
    return rng.chance(0.2) ? { status: 'partial', paidFrac: 0.5 } : { status: 'sent', paidFrac: 0 }
  }
  const addSupplier = (party: string, desc: string, amount: number, issue: number, terms: number, branchId = 'br-hre') => {
    const due = issue + terms * DAY
    const { status, paidFrac } = supplierStatus(due)
    const paid = Math.round(amount * paidFrac)
    invoices.push({ id: '', number: '', kind: 'supplier', partyId: null, partyName: party, description: desc, amountUsd: Math.round(amount), paidUsd: paid, issueDate: iso(issue), dueDate: iso(due), status, tripIds: [], branchId, payments: paid ? [{ date: iso(Math.min(now - DAY, issue + rng.int(10, terms) * DAY)), amountUsd: paid, method: 'Bank transfer', ref: `PAY-${rng.int(100000, 999999)}` }] : [] })
  }
  for (const [k, amt] of fuelGroups) {
    const [brand, mk] = k.split('|') as [string, string]
    const [y, m] = mk.split('-').map(Number) as [number, number]
    const issue = Math.min(new Date(y, m, 1).getTime() + 2 * DAY, now - DAY)
    addSupplier(brand, `Fleet fuel card statement – ${new Date(y, m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}`, amt, issue, 30)
  }
  const woGroups = new Map<string, number>()
  for (const w of workOrders) {
    if (w.status !== 'completed' || w.providerId === 'prv-01' || w.providerId === 'prv-02') continue
    const k = `${w.providerId}|${monthKey(new Date(w.completedAt!).getTime())}`
    woGroups.set(k, (woGroups.get(k) ?? 0) + w.labourCostUsd + w.partsCostUsd)
  }
  const providerNames: Record<string, string> = { 'prv-03': 'Apex Truck Service Centre', 'prv-04': 'Premier Tyre & Rubber', 'prv-05': 'Matabeleland Diesel Services', 'prv-06': 'Highfield Auto Electrical', 'prv-07': 'Eastern Truck & Trailer Repairs', 'prv-08': 'Southern Cross Refrigeration' }
  for (const [k, amt] of woGroups) {
    const [pid, mk] = k.split('|') as [string, string]
    const [y, m] = mk.split('-').map(Number) as [number, number]
    addSupplier(providerNames[pid]!, `Workshop services – ${new Date(y, m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}`, amt, Math.min(new Date(y, m, 5).getTime(), now - DAY), 30)
  }
  for (let q = 0; q < 2; q++) addSupplier('Old Mutual Insurance', `Fleet motor insurance premium – Q${4 - q} 2026`, 21500 + rng.int(-800, 800), now - (q * 90 + 20) * DAY, 30)
  addSupplier('ZINARA', 'Vehicle licensing – annual renewals batch', 7650, now - 52 * DAY, 30)

  invoices.sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  let ci = 0
  let si = 0
  for (const inv of invoices) {
    inv.id = `inv-${String(++ci).padStart(4, '0')}`
    inv.number = inv.kind === 'customer' ? `INV-${new Date(inv.issueDate).getFullYear()}-${String(1100 + ci)}` : `SUP-${String(4400 + ++si)}`
  }

  // ---- budgets (last 6 months) ---------------------------------------------
  const cats: ExpenseCategory[] = ['fuel', 'maintenance', 'toll', 'allowance', 'insurance', 'tyres', 'other']
  const actual = new Map<string, number>()
  const bump = (cat: string, t: number, amt: number) => actual.set(`${cat}|${monthKey(t)}`, (actual.get(`${cat}|${monthKey(t)}`) ?? 0) + amt)
  for (const f of fuel) bump('fuel', new Date(f.date).getTime(), f.totalUsd)
  for (const w of workOrders) if (w.status === 'completed') bump('maintenance', new Date(w.completedAt!).getTime(), w.labourCostUsd + w.partsCostUsd)
  for (const e of expenses) if (!['fuel', 'maintenance'].includes(e.category)) bump(['toll', 'allowance', 'insurance', 'tyres'].includes(e.category) ? e.category : 'other', new Date(e.date).getTime(), e.amountUsd)
  const budgets: Budget[] = []
  for (let m = 5; m >= -1; m--) {
    if (m === -1) break
    const d = new Date(now)
    d.setMonth(d.getMonth() - m, 1)
    const mk = monthKey(d.getTime())
    for (const c of cats) {
      const avgActual = [0, 1, 2, 3, 4, 5].map((i) => {
        const dd = new Date(now)
        dd.setMonth(dd.getMonth() - i, 1)
        return actual.get(`${c}|${monthKey(dd.getTime())}`) ?? 0
      })
      const ref = Math.max(200, avgActual.filter((x) => x > 0).reduce((s, x) => s + x, 0) / Math.max(1, avgActual.filter((x) => x > 0).length))
      budgets.push({ id: `bud-${mk}-${c}`, period: mk, category: c, branchId: 'all', budgetUsd: Math.round((ref * rng.float(0.94, 1.18)) / 100) * 100 })
    }
  }
  return { expenses, invoices, budgets }
}

export function buildAudit(now: number, users: User[], fleet: FleetSeed, trips: Trip[], expenses: Expense[]): AuditEntry[] {
  const rng = createRng(12)
  const entries: AuditEntry[] = []
  const hrs = (h: number) => new Date(now - h * 36e5).toISOString()
  const U = (id: string) => users.find((u) => u.id === id)!
  const add = (u: string, action: AuditEntry['action'], entityType: string, entityId: string, summary: string, hoursAgo: number) =>
    entries.push({ id: '', at: hrs(hoursAgo), userId: u, userName: U(u).name, action, entityType, entityId, summary })
  const v = fleet.vehicles
  const t = trips.filter((x) => x.status === 'completed').slice(-12)
  add('usr-01', 'login', 'session', 'usr-01', 'Signed in from 41.57.x.x (Harare)', 0.1)
  add('usr-03', 'create', 'trip', t[0]!.id, `Created trip ${t[0]!.ref}`, 2.5)
  add('usr-03', 'assign', 'trip', t[1]!.id, `Assigned vehicle ${v[3]!.reg} to ${t[1]!.ref}`, 3.2)
  add('usr-05', 'status', 'vehicle', v[13]!.id, `Changed ${v[13]!.reg} status to Maintenance`, 5)
  add('usr-06', 'approve', 'expense', expenses[expenses.length - 3]!.id, `Approved expense ${expenses[expenses.length - 3]!.ref}`, 6)
  add('usr-07', 'create', 'incident', 'inc-0034', 'Logged incident INC-2026-034', 8)
  add('usr-02', 'update', 'driver', fleet.drivers[2]!.id, `Updated licence details for ${fleet.drivers[2]!.name}`, 11)
  add('usr-04', 'create', 'trip', t[2]!.id, `Created trip ${t[2]!.ref}`, 14)
  add('usr-06', 'export', 'report', 'fuel', 'Exported Fuel Consumption report (CSV)', 20)
  add('usr-01', 'update', 'settings', 'currency', 'Changed display currency to USD', 26)
  add('usr-05', 'create', 'workorder', 'wo-0060', 'Raised work order WO-24060', 29)
  add('usr-02', 'assign', 'vehicle', v[6]!.id, `Assigned driver to ${v[6]!.reg}`, 33)
  add('usr-10', 'create', 'user', 'usr-11', 'Invited Precious Nhamo (Read-only Viewer)', 40)
  add('usr-10', 'update', 'role', 'role-viewer', 'Updated permissions for Read-only Viewer', 44)
  add('usr-03', 'status', 'trip', t[3]!.id, `Marked ${t[3]!.ref} as delayed`, 50)
  add('usr-06', 'approve', 'expense', expenses[expenses.length - 8]!.id, `Approved expense ${expenses[expenses.length - 8]!.ref}`, 57)
  add('usr-07', 'update', 'incident', 'inc-0031', 'Closed incident INC-2026-031', 70)
  add('usr-09', 'login', 'session', 'usr-09', 'Signed in from 197.221.x.x (Mutare)', 96)
  add('usr-02', 'delete', 'vehicle', 'veh-old', 'Removed decommissioned vehicle AAB 2210', 120)
  add('usr-05', 'update', 'workorder', 'wo-0058', 'Completed work order WO-24058', 140)
  add('usr-01', 'system', 'system', 'sim', 'Telematics gateway reconnected (demo)', 160)
  add('usr-06', 'create', 'invoice', 'inv-0100', 'Issued customer invoice', 190)
  entries.sort((a, b) => b.at.localeCompare(a.at))
  entries.forEach((e, i) => (e.id = `aud-${String(entries.length - i).padStart(4, '0')}`))
  void rng
  return entries
}

export function buildNotifications(now: number, fleet: FleetSeed, trips: Trip[], incidents: Incident[]): AppNotification[] {
  const mins = (m: number) => new Date(now - m * 6e4).toISOString()
  const out: AppNotification[] = []
  let n = 0
  const add = (type: AppNotification['type'], severity: AppNotification['severity'], title: string, message: string, ago: number, entity?: AppNotification['entity'], read = false) =>
    out.push({ id: `ntf-seed-${++n}`, ts: mins(ago), type, severity, title, message, entity, read })
  const v = fleet.vehicles
  const delayed = trips.filter((t) => t.status === 'delayed')
  const lic = fleet.drivers.filter((d) => new Date(d.licenceExpiry).getTime() > now && new Date(d.licenceExpiry).getTime() < now + 30 * DAY)
  const offline = fleet.vehicles.filter((x) => fleet.plans.get(x.id)!.plan.startsWith('offline'))
  if (delayed[0]) add('trip_delayed', 'warning', `Trip ${delayed[0].ref} delayed`, `${delayed[0].delayReason ?? 'Delay reported'} — ${delayed[0].delayMinutes} min behind schedule.`, 6, { type: 'trip', id: delayed[0].id })
  if (offline[0]) add('vehicle_offline', 'critical', `${offline[0].reg} went offline`, 'GPS device stopped reporting. Last known position retained.', 14, { type: 'vehicle', id: offline[0].id })
  if (lic[0]) add('licence_expiring', 'warning', 'Driver licence expiring', `${lic[0].name}'s licence expires in ${Math.ceil((new Date(lic[0].licenceExpiry).getTime() - now) / DAY)} days.`, 35, { type: 'driver', id: lic[0].id })
  add('speeding', 'critical', `${v[1]!.reg} speeding on A3`, 'Recorded 104 km/h in an 80 km/h zone near Marondera.', 48, { type: 'vehicle', id: v[1]!.id })
  add('low_fuel', 'warning', `Low fuel: ${v[10]!.reg}`, 'Fuel level dropped below 15%. Nearest approved station: TotalEnergies Kadoma.', 62, { type: 'vehicle', id: v[10]!.id })
  const inc = incidents[incidents.length - 1]
  if (inc) add('incident_reported', 'critical', `New incident ${inc.ref}`, inc.description, 95, { type: 'incident', id: inc.id }, true)
  const done = trips.filter((t) => t.status === 'completed').slice(-2)
  for (const t of done) add('delivery_completed', 'success', `Delivery completed – ${t.ref}`, `Delivered to ${t.destination.name}. POD signed by ${t.pod?.receivedBy ?? 'customer'}.`, 130 + done.indexOf(t) * 40, { type: 'trip', id: t.id }, true)
  add('maintenance_overdue', 'warning', `Service overdue: ${v[27]!.reg}`, 'Routine service is 1,240 km past the due interval.', 210, { type: 'vehicle', id: v[27]!.id }, true)
  add('geofence_enter', 'info', `${v[18]!.reg} entered Bulawayo Depot yard`, 'Arrived at depot geofence.', 260, { type: 'vehicle', id: v[18]!.id }, true)
  add('system', 'info', 'Demo data loaded', 'FleetCore is running on simulated GPS telemetry. Use the Live Tracking page to explore.', 400, undefined, true)
  out.sort((a, b) => b.ts.localeCompare(a.ts))
  void CURRENT_USER_ID
  return out
}
