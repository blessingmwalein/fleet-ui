import type {
  AppNotification, AuditEntry, Branch, Budget, Customer, DailyStat, Department, DocumentRecord, Driver, Expense, FuelCard, FuelStation, FuelTransaction, Geofence, Incident, Inspection, Invoice, Role, SafetyEvent,
  ServiceProvider, ServiceSchedule, Shipment, Trip, User, Vehicle, WorkOrder,
} from '@/types'
import { buildFleet } from './fleet'
import { buildFinance, buildAudit, buildNotifications } from './finance'
import { buildCustomers, buildOps } from './ops'
import { BRANCH_SEEDS, DEPARTMENT_SEEDS, ROLES, buildGeofences, buildUsers } from './org'
import { FUEL_STATIONS, buildDaily, buildFuel, buildMaintenance, buildSafety } from './support'

/** Everything persisted in the app database (see store/db.ts). Each key is a "collection". */
export interface DbData {
  branches: Branch[]
  departments: Department[]
  roles: Role[]
  users: User[]
  geofences: Geofence[]
  vehicles: Vehicle[]
  drivers: Driver[]
  documents: DocumentRecord[]
  customers: Customer[]
  trips: Trip[]
  shipments: Shipment[]
  fuelStations: FuelStation[]
  fuelCards: FuelCard[]
  fuelTransactions: FuelTransaction[]
  providers: ServiceProvider[]
  workOrders: WorkOrder[]
  schedules: ServiceSchedule[]
  inspections: Inspection[]
  incidents: Incident[]
  safetyEvents: SafetyEvent[]
  expenses: Expense[]
  invoices: Invoice[]
  budgets: Budget[]
  auditLog: AuditEntry[]
  dailyStats: DailyStat[]
}

export type CollectionName = keyof DbData

export interface SeedResult {
  data: DbData
  notifications: AppNotification[]
  seededAt: number
}

export function buildSeed(now: number = Date.now()): SeedResult {
  const fleet = buildFleet(now)
  const customers = buildCustomers(now)
  const ops = buildOps(now, fleet, customers)
  const fuelTransactions = buildFuel(now, fleet, ops.trips)
  const maint = buildMaintenance(now, fleet)
  const safety = buildSafety(now, fleet, ops.trips)
  const users = buildUsers(now)
  const fin = buildFinance(now, fleet, ops.trips, fuelTransactions, maint.workOrders, customers)
  const auditLog = buildAudit(now, users, fleet, ops.trips, fin.expenses)
  const notifications = buildNotifications(now, fleet, ops.trips, safety.incidents)

  return {
    seededAt: now,
    notifications,
    data: {
      branches: BRANCH_SEEDS,
      departments: DEPARTMENT_SEEDS,
      roles: ROLES,
      users,
      geofences: buildGeofences(),
      vehicles: fleet.vehicles,
      drivers: fleet.drivers,
      documents: fleet.documents,
      customers,
      trips: ops.trips,
      shipments: ops.shipments,
      fuelStations: FUEL_STATIONS,
      fuelCards: fleet.fuelCards,
      fuelTransactions,
      providers: maint.providers,
      workOrders: maint.workOrders,
      schedules: maint.schedules,
      inspections: maint.inspections,
      incidents: safety.incidents,
      safetyEvents: safety.safetyEvents,
      expenses: fin.expenses,
      invoices: fin.invoices,
      budgets: fin.budgets,
      auditLog,
      dailyStats: buildDaily(now, fleet, ops.trips, fuelTransactions),
    },
  }
}
