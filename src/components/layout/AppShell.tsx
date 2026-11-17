import * as React from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { matchNav } from '@/config/navigation'
import { useCurrentUser } from '@/hooks/useAuth'
import { registerNavigate } from '@/lib/navigation'
import { startRealtime } from '@/services/realtime'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays'
import { ConfirmHost } from '@/components/shared/ConfirmHost'
import { AccessDenied, PageSkeleton } from '@/components/shared/RouteStates'
import TripDrawerHost from '@/features/trips/TripDrawerHost'
import { Breadcrumbs } from './Breadcrumbs'
import { CommandPalette } from './CommandPalette'
import { Sidebar, SidebarContent } from './Sidebar'
import { Topbar } from './Topbar'

function useThemeEffect() {
  const theme = useUi((s) => s.theme)
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { permissions } = useCurrentUser()
  const mobileNavOpen = useUi((s) => s.mobileNavOpen)
  const setMobileNavOpen = useUi((s) => s.setMobileNavOpen)
  const openTrip = useUi((s) => s.openTrip)

  useThemeEffect()
  registerNavigate(navigate)

  // Real-time layer (simulated GPS + events). Swap for a WebSocket client in production — see services/realtime.ts.
  React.useEffect(() => startRealtime(), [])

  // `?trip=<id>` deep link opens the global trip drawer from anywhere.
  React.useEffect(() => {
    const t = params.get('trip')
    if (t) {
      openTrip(t)
      const next = new URLSearchParams(params)
      next.delete('trip')
      setParams(next, { replace: true })
    }
  }, [params, openTrip, setParams])

  React.useEffect(() => setMobileNavOpen(false), [location.pathname, setMobileNavOpen])

  const nav = matchNav(location.pathname)
  const fullBleed = !!nav?.fullBleed
  const allowed = !nav?.permission || permissions.has(nav.permission)

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-1.5 text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Skip to content</a>
      <Sidebar />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" showClose={false} className="w-72 max-w-[85vw] p-0 sm:max-w-[18rem]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" tabIndex={-1} className={cn('relative min-h-0 flex-1 outline-none', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {allowed ? (
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} className={cn(fullBleed && 'h-full')}>
              {!fullBleed && (
                <div className="mx-auto w-full max-w-[1760px] px-3 pt-3 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5 [&+*]:!pt-0">
                  <Breadcrumbs />
                </div>
              )}
              <React.Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </React.Suspense>
            </motion.div>
          ) : (
            <AccessDenied />
          )}
        </main>
      </div>

      <CommandPalette />
      <ConfirmHost />
      <TripDrawerHost />
    </div>
  )
}
