import type { RouteObject } from 'react-router-dom'

export const tripRoutes: RouteObject[] = [
  { path: 'dispatch', lazy: async () => ({ Component: (await import('./DispatchPage')).default }) },
  { path: 'trips', lazy: async () => ({ Component: (await import('./TripsPage')).default }) },
]
