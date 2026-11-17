import type { RouteObject } from 'react-router-dom'

export const fuelRoutes: RouteObject[] = [
  { path: 'fuel', lazy: async () => ({ Component: (await import('./FuelOverviewPage')).default }) },
  { path: 'fuel/transactions', lazy: async () => ({ Component: (await import('./TransactionsPage')).default }) },
  { path: 'fuel/cards', lazy: async () => ({ Component: (await import('./CardsPage')).default }) },
  { path: 'fuel/stations', lazy: async () => ({ Component: (await import('./StationsPage')).default }) },
  { path: 'fuel/reconciliation', lazy: async () => ({ Component: (await import('./ReconciliationPage')).default }) },
]
