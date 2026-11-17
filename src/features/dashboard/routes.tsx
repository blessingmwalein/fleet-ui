import type { RouteObject } from 'react-router-dom'

export const dashboardRoutes: RouteObject[] = [
  { path: 'dashboard', lazy: async () => ({ Component: (await import('./DashboardPage')).default }) },
]
