import type { RouteObject } from 'react-router-dom'

export const maintenanceRoutes: RouteObject[] = [
  { path: 'maintenance', lazy: async () => ({ Component: (await import('./MaintenanceOverviewPage')).default }) },
  { path: 'maintenance/work-orders', lazy: async () => ({ Component: (await import('./WorkOrdersPage')).default }) },
  { path: 'maintenance/schedules', lazy: async () => ({ Component: (await import('./SchedulesPage')).default }) },
  { path: 'maintenance/inspections', lazy: async () => ({ Component: (await import('./InspectionsPage')).default }) },
  { path: 'maintenance/providers', lazy: async () => ({ Component: (await import('./ProvidersPage')).default }) },
]
