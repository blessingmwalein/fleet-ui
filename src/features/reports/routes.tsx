import type { RouteObject } from 'react-router-dom'

export const reportRoutes: RouteObject[] = [
  { path: 'reports', lazy: async () => ({ Component: (await import('./ReportCentrePage')).default }) },
  { path: 'reports/:category', lazy: async () => ({ Component: (await import('./ReportPage')).default }) },
]
