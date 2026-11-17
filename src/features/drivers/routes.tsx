import type { RouteObject } from 'react-router-dom'

export const driverRoutes: RouteObject[] = [
  { path: 'drivers', lazy: async () => ({ Component: (await import('./DriversPage')).default }) },
  { path: 'drivers/:id', lazy: async () => ({ Component: (await import('./DriverDetailPage')).default }) },
]
