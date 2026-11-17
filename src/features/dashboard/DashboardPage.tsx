import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, MapPinned } from 'lucide-react'
import { downloadCsv } from '@/lib/csv'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { Page, PageHeader, Can } from '@/components/shared/Page'
import { Badge, StatusDot } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/form-controls'
import { DashboardScopeProvider, useDash } from './hooks/useDashboardScope'
import { useFleetLive } from './hooks/useFleetLive'
import { useKpis } from './hooks/useKpis'
import { KpiStrip } from './components/KpiStrip'
import { UtilisationChart } from './components/UtilisationChart'
import { AvailabilityChart } from './components/AvailabilityChart'
import { FuelTrendChart } from './components/FuelTrendChart'
import { TripsChart } from './components/TripsChart'
import { OperatingCostsChart } from './components/OperatingCostsChart'
import { DriverPerformanceChart, MaintenanceCostChart } from './components/PerformanceCharts'
import { AttentionPanel, ExpiringDocumentsPanel, TopVehiclesPanel, UpcomingMaintenancePanel } from './components/FleetPanels'
import { ActivityPanel, AlertsPanel, IncidentsPanel } from './components/ActivityPanels'
import { FleetMapCard } from './components/FleetMapCard'

/** "Live · updated 2s ago" — driven by the GPS simulator heartbeat. */
function LiveBadge() {
  const lastTickAt = useLive((s) => s.lastTickAt)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const secs = lastTickAt ? Math.max(0, Math.round((Date.now() - lastTickAt) / 1000)) : null
  const stale = secs === null || secs > 15
  return (
    <Badge tone={stale ? 'warning' : 'success'} className="gap-1.5">
      <StatusDot tone={stale ? 'warning' : 'success'} pulse={!stale} className="size-1.5 [&>span]:size-1.5" />
      {secs === null ? 'Connecting…' : stale ? `Paused · ${secs}s ago` : `Live · updated ${secs}s ago`}
    </Badge>
  )
}

function SnapshotExport() {
  const live = useFleetLive()
  const kpis = useKpis(live)
  const { range, branchName } = useDash()
  return (
    <Can perm="dashboard.export">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          downloadCsv(
            `fleetcore-overview-${new Date().toISOString().slice(0, 10)}`,
            ['KPI', 'Value', 'Unit', 'Change vs previous period (%)', 'Period', 'Branch'],
            kpis.map((k) => [k.label, Math.round(k.value * 10) / 10, k.unit ?? '', k.delta ? Math.round(k.delta.pct * 10) / 10 : '', range.label, branchName ?? 'All branches']),
          )
        }
      >
        <Download /> Export snapshot
      </Button>
    </Can>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-lg lg:col-span-7 xl:col-span-8" />
        <Skeleton className="h-80 rounded-lg lg:col-span-5 xl:col-span-4" />
        <Skeleton className="h-72 rounded-lg lg:col-span-6" />
        <Skeleton className="h-72 rounded-lg lg:col-span-6" />
      </div>
    </div>
  )
}

function DashboardBody() {
  const { range, branchName } = useDash()
  const company = useSettings((s) => s.company.name)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 350)
    return () => clearTimeout(id)
  }, [])

  return (
    <Page>
      <PageHeader
        title="Executive overview"
        description={`${company} · ${range.label} · ${branchName ?? 'All branches'}`}
        meta={<LiveBadge />}
        actions={
          <>
            <SnapshotExport />
            <Button asChild size="sm">
              <Link to="/tracking"><MapPinned /> Live map</Link>
            </Button>
          </>
        }
      />
      {!ready ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-3">
          <KpiStrip />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 [&>div]:min-w-0 [&>div>section]:h-full">
            <div className="lg:col-span-7 xl:col-span-8"><UtilisationChart /></div>
            <div className="lg:col-span-5 xl:col-span-4"><AvailabilityChart /></div>

            <div className="lg:col-span-6"><FuelTrendChart /></div>
            <div className="lg:col-span-6"><TripsChart /></div>

            <div className="lg:col-span-7 xl:col-span-8"><OperatingCostsChart /></div>
            <div className="lg:col-span-5 xl:col-span-4"><MaintenanceCostChart /></div>

            <div className="lg:col-span-6 xl:col-span-4"><AttentionPanel /></div>
            <div className="lg:col-span-6 xl:col-span-4"><AlertsPanel /></div>
            <div className="lg:col-span-12 xl:col-span-4"><FleetMapCard /></div>

            <div className="lg:col-span-6 xl:col-span-4"><DriverPerformanceChart /></div>
            <div className="lg:col-span-6 xl:col-span-4"><TopVehiclesPanel /></div>
            <div className="lg:col-span-12 xl:col-span-4"><UpcomingMaintenancePanel /></div>

            <div className="lg:col-span-6 xl:col-span-4"><ActivityPanel /></div>
            <div className="lg:col-span-6 xl:col-span-4"><ExpiringDocumentsPanel /></div>
            <div className="lg:col-span-12 xl:col-span-4"><IncidentsPanel /></div>
          </div>
        </div>
      )}
    </Page>
  )
}

export default function DashboardPage() {
  return (
    <DashboardScopeProvider>
      <DashboardBody />
    </DashboardScopeProvider>
  )
}
