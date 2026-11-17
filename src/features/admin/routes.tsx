import type { RouteObject } from 'react-router-dom'
import { Navigate } from 'react-router-dom'

/** Administration module — every page is code-split. `/admin` redirects to the user directory. */
export const adminRoutes: RouteObject[] = [
  { path: 'admin', element: <Navigate to="/admin/users" replace /> },
  { path: 'admin/users', lazy: async () => ({ Component: (await import('./UsersPage')).default }) },
  { path: 'admin/roles', lazy: async () => ({ Component: (await import('./RolesPage')).default }) },
  { path: 'admin/organisation', lazy: async () => ({ Component: (await import('./OrganisationPage')).default }) },
  { path: 'admin/notifications', lazy: async () => ({ Component: (await import('./NotificationsPage')).default }) },
  { path: 'admin/audit', lazy: async () => ({ Component: (await import('./AuditPage')).default }) },
  { path: 'admin/settings', lazy: async () => ({ Component: (await import('./SettingsPage')).default }) },
]
