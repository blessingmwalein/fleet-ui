import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, PageSkeleton, RouteError } from '@/components/shared/RouteStates'
import { adminRoutes } from '@/features/admin/routes'
import { dashboardRoutes } from '@/features/dashboard/routes'
import { driverRoutes } from '@/features/drivers/routes'
import { financeRoutes } from '@/features/finance/routes'
import { fuelRoutes } from '@/features/fuel/routes'
import { maintenanceRoutes } from '@/features/maintenance/routes'
import { reportRoutes } from '@/features/reports/routes'
import { safetyRoutes } from '@/features/safety/routes'
import { shipmentRoutes } from '@/features/shipments/routes'
import { trackingRoutes } from '@/features/tracking/routes'
import { tripRoutes } from '@/features/trips/routes'
import { vehicleRoutes } from '@/features/vehicles/routes'

/**
 * Each feature module owns its route table (`features/<module>/routes.tsx`).
 * Pages are code-split with the data-router `lazy` option. RBAC is enforced in AppShell from config/navigation.ts.
 */
const children: RouteObject[] = [
  { index: true, element: <Navigate to="/dashboard" replace /> },
  ...dashboardRoutes,
  ...trackingRoutes,
  ...tripRoutes,
  ...shipmentRoutes,
  ...vehicleRoutes,
  ...driverRoutes,
  ...maintenanceRoutes,
  ...fuelRoutes,
  ...financeRoutes,
  ...safetyRoutes,
  ...reportRoutes,
  ...adminRoutes,
  { path: '*', element: <NotFound /> },
]

export const router = createBrowserRouter([{ path: '/', element: <AppShell />, HydrateFallback: PageSkeleton, errorElement: <RouteError />, children }])
