import type { RouteObject } from 'react-router-dom'

export const shipmentRoutes: RouteObject[] = [
  { path: 'shipments', lazy: async () => ({ Component: (await import('./ShipmentsPage')).default }) },
  { path: 'shipments/:id', lazy: async () => ({ Component: (await import('./ShipmentDetailPage')).default }) },
  { path: 'customers', lazy: async () => ({ Component: (await import('./CustomersPage')).default }) },
  { path: 'customers/:id', lazy: async () => ({ Component: (await import('./CustomerDetailPage')).default }) },
]
