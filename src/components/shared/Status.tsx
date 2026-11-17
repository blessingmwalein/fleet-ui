import { Bike, Bus, CarFront, Container, Droplets, Snowflake, Truck, Van, Wrench, type LucideIcon } from 'lucide-react'
import type { VehicleCategory } from '@/types'
import { Badge, StatusDot, type Tone } from '@/components/ui/display'
import { expiryState, statusMeta, VEHICLE_CATEGORY, type StatusKind } from '@/config/status'
import { cn } from '@/lib/utils'

/** `<Status kind="trip" value="in_transit" />` — canonical status badge for every domain enum. */
export function Status({ kind, value, dot = true, pulse, className }: { kind: StatusKind; value: string; dot?: boolean; pulse?: boolean; className?: string }) {
  const meta = statusMeta(kind, value)
  return (
    <Badge tone={meta.tone} className={cn('gap-1.5', className)}>
      {dot && <StatusDot tone={meta.tone} pulse={pulse ?? (kind === 'live' && value === 'moving')} className="size-1.5 [&>span]:size-1.5" />}
      {meta.label}
    </Badge>
  )
}

export const CATEGORY_ICON: Record<VehicleCategory, LucideIcon> = {
  heavy_truck: Truck,
  light_truck: Truck,
  delivery_van: Van,
  pickup: CarFront,
  bus: Bus,
  tanker: Droplets,
  refrigerated: Snowflake,
  service: Wrench,
  motorcycle: Bike,
}

export function CategoryIcon({ category, className }: { category: VehicleCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Container
  return <Icon className={cn('size-4', className)} />
}

export function CategoryBadge({ category }: { category: VehicleCategory }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <CategoryIcon category={category} className="size-3.5 text-muted-foreground" />
      {VEHICLE_CATEGORY[category]}
    </span>
  )
}

/** Expiry badge for licences, insurance & roadworthiness: "Expired 12d ago" / "14d left" / "Valid". */
export function ExpiryBadge({ iso, warnDays = 30, showValid = true }: { iso: string | null | undefined; warnDays?: number; showValid?: boolean }) {
  const e = expiryState(iso, warnDays)
  if (e.state === 'valid' && !showValid) return null
  return <Badge tone={e.tone as Tone}>{e.label}</Badge>
}

/** Registration plate styling — monospaced and tabular. */
export function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12.5px] font-medium tracking-tight', className)}>{children}</span>
}
