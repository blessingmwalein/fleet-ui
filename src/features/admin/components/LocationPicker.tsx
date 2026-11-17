import * as React from 'react'
import { useWatch } from 'react-hook-form'
import { MapPin } from 'lucide-react'
import type { AnyForm } from '@/components/forms/fields'
import { Skeleton } from '@/components/ui/form-controls'
import type { Geofence } from '@/types'

const GeofenceMap = React.lazy(() => import('./GeofenceMap'))

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const round = (n: number) => Math.round(n * 1e5) / 1e5

/** Click-to-set map for latitude/longitude (and optional radius) fields of a react-hook-form form. */
export function LocationPicker({ form, latName = 'lat', lngName = 'lng', radiusName, fallbackRadius = 150, context, height = 220 }: { form: AnyForm; latName?: string; lngName?: string; radiusName?: string; fallbackRadius?: number; context?: Geofence[]; height?: number }) {
  const [lat, lng, radius] = useWatch({ control: form.control, name: [latName, lngName, radiusName ?? latName] }) as [unknown, unknown, unknown]
  const valid = finite(lat) && finite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const draft = valid ? { lat, lng, radiusM: radiusName && finite(radius) && radius > 0 ? radius : fallbackRadius } : null
  return (
    <div className="space-y-1.5">
      <React.Suspense fallback={<Skeleton style={{ height }} className="w-full" />}>
        <GeofenceMap
          height={height}
          fences={context}
          draft={draft}
          onPick={(la, ln) => {
            form.setValue(latName, round(la), { shouldDirty: true, shouldValidate: true })
            form.setValue(lngName, round(ln), { shouldDirty: true, shouldValidate: true })
          }}
        />
      </React.Suspense>
      <p className="flex items-center gap-1.5 text-xs text-subtle-foreground"><MapPin className="size-3" /> Click the map or drag the pin to set the position — or type coordinates above.</p>
    </div>
  )
}
