import { deliveryPerformance } from './delivery-performance'
import { driverPerformance } from './driver-performance'
import { financialPerformance } from './financial-performance'
import { fleetUtilisation } from './fleet-utilisation'
import { fuelConsumption } from './fuel-consumption'
import { maintenanceCosts } from './maintenance-costs'
import { operatingExpenses } from './operating-expenses'
import { safetyIncidents } from './safety-incidents'
import { tripPerformance } from './trip-performance'
import { vehiclePerformance } from './vehicle-performance'
import type { ReportSpec } from './types'

export const SPECS: Record<string, ReportSpec> = {
  'fleet-utilisation': fleetUtilisation,
  'vehicle-performance': vehiclePerformance,
  'driver-performance': driverPerformance,
  'trip-performance': tripPerformance,
  'delivery-performance': deliveryPerformance,
  'fuel-consumption': fuelConsumption,
  'maintenance-costs': maintenanceCosts,
  'operating-expenses': operatingExpenses,
  'safety-incidents': safetyIncidents,
  'financial-performance': financialPerformance,
}
