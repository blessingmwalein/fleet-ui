import type { RouteObject } from 'react-router-dom'

export const safetyRoutes: RouteObject[] = [
  { path: 'safety', lazy: async () => ({ Component: (await import('./SafetyOverviewPage')).default }) },
  { path: 'safety/incidents', lazy: async () => ({ Component: (await import('./IncidentsPage')).default }) },
  { path: 'safety/behaviour', lazy: async () => ({ Component: (await import('./BehaviourPage')).default }) },
  { path: 'safety/compliance', lazy: async () => ({ Component: (await import('./CompliancePage')).default }) },
]
