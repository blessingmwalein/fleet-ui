import type { RouteObject } from 'react-router-dom'

export const vehicleRoutes: RouteObject[] = [
  { path: 'vehicles', lazy: async () => ({ Component: (await import('./VehiclesPage')).default }) },
  { path: 'vehicles/:id', lazy: async () => ({ Component: (await import('./VehicleDetailPage')).default }) },
]
