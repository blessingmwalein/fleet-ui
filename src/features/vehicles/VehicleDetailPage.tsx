import { useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, CalendarClock, ChevronDown, CircleGauge, ClipboardList, Fuel, History, LayoutDashboard, MapPin, Pencil, Receipt, Route, ShieldAlert, ShieldCheck, Trash2, Truck, UserCheck, Wallet, Wrench, FilePlus2, CheckCircle2, FileText, Gauge,
} from 'lucide-react'
import { useDb } from '@/store/db'
import { useCan } from '@/hooks/useAuth'
import { useMoney } from '@/hooks/useMoney'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Page } from '@/components/shared/Page'
import { KpiCard } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { CategoryIcon, Plate } from '@/components/shared/Status'
import { BranchLink, DriverLink } from '@/components/shared/EntityLink'
import { VEHICLE_CATEGORY } from '@/config/status'
import { fmtDate, fmtNumber } from '@/lib/format'
import { VehicleStatusBadge } from './components'
import { useVehicleDialogs } from './VehicleDialogs'
import { useVehicleKpis } from './useVehicleKpis'
import { confirmAndDeleteVehicles } from './deleteFlow'
import { ActivityTab } from './ActivityTab'
import { LiveTab, OverviewTab, SpecsTab } from './tabsCore'
import { FuelTab, MaintenanceTab, TripsTab } from './tabsData1'
import { DocumentsTab, ExpensesTab, IncidentsTab } from './tabsData2'

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'specs', label: 'Specifications', icon: ClipboardList },
  { value: 'live', label: 'Live location', icon: MapPin },
  { value: 'trips', label: 'Trip history', icon: Route },
  { value: 'maintenance', label: 'Maintenance', icon: Wrench },
  { value: 'fuel', label: 'Fuel history', icon: Fuel },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  { value: 'documents', label: 'Documents', icon: FileText },
  { value: 'incidents', label: 'Incidents', icon: ShieldAlert },
  { value: 'activity', label: 'Activity', icon: History },
] as const

export default function VehicleDetailPage() {
  const { id = '' } = useParams()
  const vehicle = useDb((s) => s.vehicles.find((v) => v.id === id))
  if (!vehicle) {
    return (
      <Page>
        <div className="panel">
          <EmptyState
            icon={Truck}
            title="Vehicle not found"
            description={`No vehicle with id “${id}” exists. It may have been deleted or the link is incorrect.`}
            action={<Button asChild size="sm"><Link to="/vehicles"><ArrowLeft /> Back to vehicles</Link></Button>}
          />
        </div>
      </Page>
    )
  }
  return <VehicleDetail key={vehicle.id} vehicleId={vehicle.id} />
}

function VehicleDetail({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const vehicle = useDb((s) => s.vehicles.find((v) => v.id === vehicleId))!
  const kpis = useVehicleKpis(vehicle)
  const money = useMoney()
  const canEdit = useCan('vehicles.edit')
  const canDelete = useCan('vehicles.delete')
  const dlg = useVehicleDialogs()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'overview'

  const goTab = useCallback(
    (t: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (t === 'overview') next.delete('tab')
        else next.set('tab', t)
        return next
      }, { replace: true }),
    [setParams],
  )

  const v = vehicle
  const { live, service, utilisation, cost, compliance } = kpis
  const tabProps = { vehicle: v, kpis, show: dlg.show, goTab }
  const compBad = compliance.expired + compliance.missing

  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link to="/vehicles"><ArrowLeft /> All vehicles</Link></Button>

      {/* Header */}
      <div className="panel mb-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 lg:flex-nowrap">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary">
              <CategoryIcon category={v.category} className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight"><Plate className="text-xl">{v.reg}</Plate></h1>
                <VehicleStatusBadge statusKey={kpis.statusKey} />
                {live?.speeding && <Badge tone="danger">Speeding</Badge>}
                {kpis.gpsDown && <Badge tone="danger">GPS offline</Badge>}
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{v.make} {v.model} · {v.year} · {VEHICLE_CATEGORY[v.category]} · {v.colour}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">Driver <DriverLink id={v.driverId} avatar fallback="Unassigned" /></span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">Branch <BranchLink id={v.branchId} /></span>
                {live && <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground"><MapPin className="size-3 shrink-0" /><span className="truncate">{live.location}</span></span>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit && <Button onClick={() => dlg.show({ kind: 'edit', vehicle: v })}><Pencil /> Edit</Button>}
            <Button variant="outline" asChild><Link to={`/tracking?vehicle=${v.id}`}><MapPin /> Track on map</Link></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Actions <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {canEdit && <DropdownMenuItem onSelect={() => dlg.show({ kind: 'edit', vehicle: v })}><Pencil /> Edit vehicle</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => dlg.show({ kind: 'assign', vehicle: v })}><UserCheck /> {v.driverId ? 'Change / unassign driver' : 'Assign driver'}</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => dlg.show({ kind: 'status', vehicles: [v] })}><CheckCircle2 /> Update status</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => dlg.show({ kind: 'maintenance', vehicle: v })}><Wrench /> Schedule maintenance</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => dlg.show({ kind: 'document', vehicle: v })}><FilePlus2 /> Upload document</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => navigate(`/tracking?vehicle=${v.id}`)}><MapPin /> Track on map</DropdownMenuItem>
                {canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                  <DropdownMenuItem destructive onSelect={() => void confirmAndDeleteVehicles([v]).then((d) => d.length && navigate('/vehicles'))}>
                    <Trash2 /> Delete vehicle
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Odometer" icon={CircleGauge} value={kpis.odometer} format={(n) => fmtNumber(n)} unit="km" hint={live ? 'Live odometer from telematics' : 'Recorded odometer'} />
        <KpiCard label="Fuel level" icon={Fuel} value={kpis.fuelPct} unit="%" status={kpis.fuelPct < 15 ? 'danger' : kpis.fuelPct < 30 ? 'warning' : 'success'} hint={`≈ ${Math.round((kpis.fuelPct / 100) * v.tankCapacityL)} L of ${v.tankCapacityL} L tank`} />
        <KpiCard label="Utilisation (30d)" icon={Gauge} value={Math.round(utilisation.pct)} unit="%" spark={utilisation.hours} hint={`${utilisation.activeDays} active days · ${Math.round(utilisation.totalHours)} trip hours in the last 30 days`} />
        <KpiCard label="Cost per km (90d)" icon={Wallet} value={cost.perKm === null ? '—' : money(cost.perKm, { digits: 2 })} hint={`${money(cost.total)} (fuel ${money(cost.fuel)}, maintenance ${money(cost.maintenance)}, other ${money(cost.other)}) over ${fmtNumber(cost.km)} km`} />
        <KpiCard
          label="Next service"
          icon={CalendarClock}
          value={service.dueTs ? fmtDate(service.dueTs, 'dd MMM yyyy') : '—'}
          status={service.overdue ? 'danger' : service.state === 'due_soon' ? 'warning' : service.schedule ? 'success' : undefined}
          hint={service.schedule ? `${service.schedule.task}${service.overdue ? ' — overdue' : ''}` : 'No service schedule'}
        />
        <KpiCard label="Compliance" icon={ShieldCheck} value={`${compliance.valid}/${compliance.total}`} status={compBad ? 'danger' : compliance.expiring ? 'warning' : 'success'} hint="Required documents valid" onClick={() => goTab('documents')} />
      </div>

      <Tabs value={tab} onValueChange={goTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}><t.icon /> {t.label}</TabsTrigger>
          ))}
        </TabsList>
        <div className="pt-4">
          <TabsContent value="overview"><OverviewTab {...tabProps} /></TabsContent>
          <TabsContent value="specs"><SpecsTab {...tabProps} /></TabsContent>
          <TabsContent value="live"><LiveTab {...tabProps} /></TabsContent>
          <TabsContent value="trips"><TripsTab {...tabProps} /></TabsContent>
          <TabsContent value="maintenance"><MaintenanceTab {...tabProps} /></TabsContent>
          <TabsContent value="fuel"><FuelTab {...tabProps} /></TabsContent>
          <TabsContent value="expenses"><ExpensesTab {...tabProps} /></TabsContent>
          <TabsContent value="documents"><DocumentsTab {...tabProps} /></TabsContent>
          <TabsContent value="incidents"><IncidentsTab {...tabProps} /></TabsContent>
          <TabsContent value="activity"><ActivityTab vehicle={v} /></TabsContent>
        </div>
      </Tabs>
      {dlg.host}
    </Page>
  )
}
