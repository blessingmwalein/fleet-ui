import type { RouteObject } from 'react-router-dom'

export const trackingRoutes: RouteObject[] = [{ path: 'tracking', lazy: async () => ({ Component: (await import('./TrackingPage')).default }) }]
