import * as React from 'react'
import { z } from 'zod'
import { toast } from 'sonner'
import { useDb } from '@/store/db'
import { useById } from '@/hooks/useLookup'
import { useDriverOptions } from '@/hooks/useOptions'
import { fmtDateTime, fmtDuration, fmtKm } from '@/lib/format'
import { ROUTE_BY_ID, routeEndpoints } from '@/data/routes'
import { cn } from '@/lib/utils'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { FormDialog } from '@/components/forms/FormDialog'
import { ComboField, SelectField } from '@/components/forms/fields'
import { MiniMap } from '@/components/map/MiniMap'
import { Plate, Status } from '@/components/shared/Status'
import { EmptyState } from '@/components/shared/EmptyState'
import { History } from 'lucide-react'

// ---------------------------------------------------------------------------
// Assign driver / trip to a vehicle
// ---------------------------------------------------------------------------
const assignSchema = z.object({ driverId: z.string().optional(), tripId: z.string().optional() })

export function AssignVehicleDialog({ vehicleId, open, onOpenChange }: { vehicleId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const vehicle = useById('vehicles')(vehicleId)
  const trips = useDb((s) => s.trips)
  const drivers = useDb((s) => s.drivers)
  const driverOptions = useDriverOptions()
  const tripOptions = React.useMemo(
    () =>
      trips
        .filter((t) => ['awaiting_assignment', 'scheduled', 'ready'].includes(t.status) && (!t.vehicleId || t.vehicleId === vehicleId))
        .slice(0, 80)
        .map((t) => ({ value: t.id, label: `${t.ref} · ${t.origin.city} → ${t.destination.city}` })),
    [trips, vehicleId],
  )
  if (!vehicle) return null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign ${vehicle.reg}`}
      description="Change the vehicle's driver and/or allocate it to an upcoming trip."
      schema={assignSchema}
      defaultValues={{ driverId: vehicle.driverId ?? '', tripId: '' }}
      submitLabel="Apply assignment"
      onSubmit={(v) => {
        const st = useDb.getState()
        if (v.driverId && v.driverId !== vehicle.driverId) {
          const prev = drivers.find((d) => d.vehicleId === vehicleId)
          if (prev) st.update('drivers', prev.id, { vehicleId: null }, { silent: true })
          const nextDriver = drivers.find((d) => d.id === v.driverId)
          if (nextDriver?.vehicleId && nextDriver.vehicleId !== vehicleId) st.update('vehicles', nextDriver.vehicleId, { driverId: null }, { silent: true })
          st.update('vehicles', vehicleId, { driverId: v.driverId }, { action: 'assign', summary: `Assigned ${nextDriver?.name} to ${vehicle.reg}` })
          st.update('drivers', v.driverId, { vehicleId }, { silent: true })
        }
        if (v.tripId) {
          const t = trips.find((x) => x.id === v.tripId)
          st.update('trips', v.tripId, { vehicleId, driverId: v.driverId || vehicle.driverId, status: t?.status === 'awaiting_assignment' ? 'ready' : t?.status }, { action: 'assign', summary: `Allocated ${vehicle.reg} to ${t?.ref}` })
        }
        toast.success('Assignment updated', { description: vehicle.reg })
      }}
    >
      {(form) => (
        <>
          <ComboField form={form} name="driverId" label="Driver" options={driverOptions} placeholder="Select a driver" searchPlaceholder="Search drivers…" clearable />
          <SelectField form={form} name="tripId" label="Allocate to upcoming trip (optional)" options={tripOptions} allowEmpty emptyLabel="No trip" placeholder="Select a trip" hint={tripOptions.length ? 'Trips that are unassigned, scheduled or ready for dispatch.' : 'No upcoming trips available for this vehicle.'} />
        </>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Journey history: recent trips with a route map
// ---------------------------------------------------------------------------
export function JourneyHistoryDialog({ vehicleId, open, onOpenChange }: { vehicleId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const vehicle = useById('vehicles')(vehicleId)
  const allTrips = useDb((s) => s.trips)
  const trips = React.useMemo(
    () => allTrips.filter((t) => t.vehicleId === vehicleId && ['completed', 'in_transit', 'delayed'].includes(t.status)).sort((a, b) => (b.actualStart ?? b.scheduledStart).localeCompare(a.actualStart ?? a.scheduledStart)).slice(0, 14),
    [allTrips, vehicleId],
  )
  const [selected, setSelected] = React.useState<string | null>(null)
  React.useEffect(() => { if (open) setSelected(trips[0]?.id ?? null) }, [open, trips])
  const trip = trips.find((t) => t.id === selected) ?? trips[0]
  const route = trip ? ROUTE_BY_ID[trip.routeId] : undefined
  const ep = route && trip ? routeEndpoints(route, trip.routeDir) : null
  if (!vehicle) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[min(640px,92dvh)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /> Journey history · <Plate>{vehicle.reg}</Plate></DialogTitle>
          <DialogDescription>Most recent trips and the route driven. Select a trip to see it on the map.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-0 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-0 overflow-y-auto rounded-lg border border-border">
            {trips.length === 0 ? (
              <EmptyState compact title="No trips recorded" />
            ) : (
              trips.map((t) => (
                <button key={t.id} type="button" onClick={() => setSelected(t.id)} className={cn('flex w-full flex-col gap-1 border-b border-border/70 px-3 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/50', trip?.id === t.id && 'bg-primary/8')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-medium">{t.ref}</span>
                    <Status kind="trip" value={t.status} />
                  </span>
                  <span className="text-[13px]">{t.origin.name.split(' – ')[0]} → {t.destination.name.split(' – ')[0]}</span>
                  <span className="num text-xs text-muted-foreground">{fmtDateTime(t.actualStart ?? t.scheduledStart)} · {fmtKm(t.actualDistanceKm ?? t.plannedDistanceKm, 1)} · {fmtDuration(t.actualDurationMin ?? t.plannedDurationMin)}</span>
                </button>
              ))
            )}
          </div>
          <div className="min-h-[260px]">
            {trip && route && ep ? (
              <MiniMap
                height="100%"
                className="h-full min-h-[260px]"
                routeId={route.id}
                markers={[
                  { id: 'o', ...ep.from, kind: 'origin', label: trip.origin.name.split(' – ')[0] },
                  { id: 'd', ...ep.to, kind: 'destination', label: trip.destination.name.split(' – ')[0] },
                ]}
              />
            ) : (
              <EmptyState compact title="Select a trip" />
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
