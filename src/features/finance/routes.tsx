import type { RouteObject } from 'react-router-dom'

export const financeRoutes: RouteObject[] = [
  { path: 'finance', lazy: async () => ({ Component: (await import('./FinanceOverviewPage')).default }) },
  { path: 'finance/expenses', lazy: async () => ({ Component: (await import('./ExpensesPage')).default }) },
  { path: 'finance/invoices', lazy: async () => ({ Component: (await import('./InvoicesPage')).default }) },
  { path: 'finance/budgets', lazy: async () => ({ Component: (await import('./BudgetsPage')).default }) },
  { path: 'finance/profitability', lazy: async () => ({ Component: (await import('./ProfitabilityPage')).default }) },
]
