import * as React from 'react'
import { useUi } from '@/store/ui'
import { useTripDialogs } from './tripStore'

// Heavy parts (map, forms, dialogs) are code-split so the app shell stays light.
const TripDrawer = React.lazy(() => import('./TripDrawer'))
const TripDialogsHost = React.lazy(() => import('./TripDialogs'))

/**
 * Global trip detail drawer + workflow dialogs. Mounted once in AppShell; opened via `useUi().openTrip(id)`,
 * <TripLink />, `?trip=<id>` — and the dialogs via the helpers exported from `tripStore.ts`.
 */
export default function TripDrawerHost() {
  const id = useUi((s) => s.tripDrawerId)
  const dialog = useTripDialogs((s) => s.dialog)
  const [drawerSeen, setDrawerSeen] = React.useState(false)
  React.useEffect(() => {
    if (id) setDrawerSeen(true)
  }, [id])
  return (
    <>
      {(id || drawerSeen) && (
        <React.Suspense fallback={null}>
          <TripDrawer />
        </React.Suspense>
      )}
      {dialog && (
        <React.Suspense fallback={null}>
          <TripDialogsHost />
        </React.Suspense>
      )}
    </>
  )
}
