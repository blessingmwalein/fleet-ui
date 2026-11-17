import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { PanelLeftOpen, List } from 'lucide-react'
import type { LiveState } from '@/types'
import type { BaseMapId } from '@/components/map/mapStyle'
import { useIsDark } from '@/hooks/useIsDark'
import { useIsCompact } from '@/hooks/useMediaQuery'
import { useLive } from '@/store/live'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, Tooltip } from '@/components/ui/overlays'
import { DEFAULT_MAP_OPTIONS, FleetMap, type FleetMapHandle, type FleetMapOptions } from './FleetMap'
import { LocationSearch } from './LocationSearch'
import { MapLegend, MapToolbar, SimControl, type BaseChoice } from './MapToolbar'
import { AssignVehicleDialog, JourneyHistoryDialog } from './TrackingDialogs'
import { VehicleList } from './VehicleList'
import { VehiclePanel } from './VehiclePanel'
import { STATE_ORDER, useTrackingRows } from './useTrackingRows'

const PREFS_KEY = 'fleetcore.tracking.v1'

function loadPrefs(): { options: FleetMapOptions; base: BaseChoice; listOpen: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { options: { ...DEFAULT_MAP_OPTIONS, ...(p.options ?? {}) }, base: p.base ?? 'auto', listOpen: p.listOpen ?? true }
  } catch {
    return { options: DEFAULT_MAP_OPTIONS, base: 'auto', listOpen: true }
  }
}

export default function TrackingPage() {
  const [params, setParams] = useSearchParams()
  const compact = useIsCompact()
  const dark = useIsDark()
  const running = useLive((s) => s.running)
  const rows = useTrackingRows()
  const mapRef = React.useRef<FleetMapHandle>(null)
  const wrapRef = React.useRef<HTMLDivElement>(null)

  const prefs = React.useMemo(loadPrefs, [])
  const [options, setOptionsState] = React.useState<FleetMapOptions>(prefs.options)
  const [baseChoice, setBaseChoice] = React.useState<BaseChoice>(prefs.base)
  const [listOpen, setListOpen] = React.useState(prefs.listOpen)
  const [mobileList, setMobileList] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<Set<LiveState>>(() => new Set(STATE_ORDER))
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(params.get('vehicle'))
  const [follow, setFollow] = React.useState(!!params.get('vehicle'))
  const [headingUp, setHeadingUp] = React.useState(false)
  const [panelMin, setPanelMin] = React.useState(false)
  const [searchMarker, setSearchMarker] = React.useState<{ lng: number; lat: number; label: string } | null>(null)
  const [bearing, setBearing] = React.useState(0)
  const [pitch, setPitch] = React.useState(0)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)

  React.useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ options, base: baseChoice, listOpen }))
    } catch { /* ignore */ }
  }, [options, baseChoice, listOpen])

  const setOptions = React.useCallback((patch: Partial<FleetMapOptions>) => setOptionsState((o) => ({ ...o, ...patch })), [])

  // selection ⇄ URL (?vehicle=)
  const select = React.useCallback((id: string | null) => {
    setSelectedId(id)
    setFollow(!!id) // focus view: zoom to street level and keep the vehicle centred
    if (!id) setHeadingUp(false)
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.set('vehicle', id)
      else n.delete('vehicle')
      return n
    }, { replace: true })
    if (id) setMobileList(false)
  }, [setParams])

  React.useEffect(() => {
    const v = params.get('vehicle')
    if (v && v !== selectedId && rows.some((r) => r.id === v)) setSelectedId(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  // counts + filtered rows
  const counts = React.useMemo(() => {
    const c = { all: rows.length, moving: 0, idle: 0, stopped: 0, maintenance: 0, offline: 0 } as Record<LiveState | 'all', number>
    for (const r of rows) c[r.state]++
    return c
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => statusFilter.has(r.state) && (!q || r.hay.includes(q)))
      .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.reg.localeCompare(b.reg))
  }, [rows, statusFilter, query])

  const visibleIds = React.useMemo(() => (statusFilter.size === STATE_ORDER.length && !query.trim() ? null : new Set(filtered.map((r) => r.id))), [filtered, statusFilter, query])

  const effectiveBase: BaseMapId = baseChoice === 'auto' ? (dark ? 'dark' : 'light') : baseChoice

  // fullscreen
  React.useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrapRef.current?.requestFullscreen?.()
  }

  // resize map when panels open/close
  React.useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 80)
    return () => clearTimeout(t)
  }, [listOpen, compact, fullscreen])

  // Esc deselects
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId && !(e.target instanceof HTMLInputElement)) select(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedId, select])

  const list = (
    <VehicleList rows={filtered} counts={counts} selectedId={selectedId} onSelect={select} statusFilter={statusFilter} onStatusFilter={setStatusFilter} query={query} onQuery={setQuery} onCollapse={compact ? undefined : () => setListOpen(false)} />
  )

  return (
    <div ref={wrapRef} className="relative flex h-full min-h-0 bg-background">
      {!compact && listOpen && <aside className="w-[304px] shrink-0 border-r border-border">{list}</aside>}

      <div className="relative min-w-0 flex-1">
        <FleetMap
          ref={mapRef}
          baseMap={effectiveBase}
          options={options}
          selectedId={selectedId}
          onSelect={select}
          follow={follow}
          headingUp={headingUp}
          insets={{ right: selectedId && !compact && !panelMin ? 400 : 0, bottom: selectedId && compact && !panelMin ? 320 : 0 }}
          onFollowBreak={() => setFollow(false)}
          visibleIds={visibleIds}
          searchMarker={searchMarker}
          onBearing={setBearing}
          onPitch={setPitch}
        />

        {/* top-left: list toggle + location search */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
          {compact ? (
            <Button variant="outline" size="sm" className="pointer-events-auto h-9 bg-card/95 shadow-pop backdrop-blur" onClick={() => setMobileList(true)}>
              <List /> Vehicles <span className="num text-muted-foreground">{counts.moving}/{counts.all}</span>
            </Button>
          ) : (
            !listOpen && (
              <Tooltip content="Show vehicle list" side="right">
                <Button variant="outline" size="icon" className="pointer-events-auto size-9 bg-card/95 shadow-pop backdrop-blur" onClick={() => setListOpen(true)} aria-label="Show vehicle list"><PanelLeftOpen /></Button>
              </Tooltip>
            )
          )}
          <LocationSearch
            active={!!searchMarker}
            onPick={(h) => {
              setSearchMarker({ lng: h.lng, lat: h.lat, label: h.label })
              mapRef.current?.flyTo(h.lng, h.lat, 13)
            }}
            onClear={() => setSearchMarker(null)}
          />
        </div>

        {/* top-right: toolbar */}
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <MapToolbar
            baseChoice={baseChoice}
            onBaseChoice={setBaseChoice}
            effectiveBase={effectiveBase}
            options={options}
            onOptions={setOptions}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            onFitAll={() => mapRef.current?.fitAll()}
            onLocate={() => selectedId && mapRef.current?.locate(selectedId)}
            canLocate={!!selectedId}
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            bearing={bearing}
            pitch={pitch}
            onResetNorth={() => mapRef.current?.resetNorth()}
            onTilt={() => mapRef.current?.toggleTilt()}
            fullscreen={fullscreen}
            onFullscreen={toggleFullscreen}
            headingUp={headingUp}
            onHeadingUp={() => { if (selectedId) { setFollow(true); setHeadingUp((h) => !h) } }}
            canHeadingUp={!!selectedId}
          />
        </div>

        {/* bottom-left: demo notice + legend */}
        <div className="pointer-events-none absolute bottom-6 left-3 z-10 flex flex-wrap items-center gap-2">
          <SimControl running={running} />
          <MapLegend />
        </div>

        {/* selected vehicle: floating card (desktop) / bottom drawer (mobile) */}
        <AnimatePresence>
          {selectedId && (
            <div key={selectedId} className={compact ? 'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] p-2' : 'pointer-events-none absolute bottom-6 right-16 top-3 z-10 flex w-[372px] max-w-[calc(100%-5rem)] flex-col justify-start'}>
              <VehiclePanel
                id={selectedId}
                onClose={() => select(null)}
                follow={follow}
                onToggleFollow={() => setFollow((f) => !f)}
                onHistory={() => setHistoryOpen(true)}
                onAssign={() => setAssignOpen(true)}
                minimized={panelMin}
                onToggleMin={() => setPanelMin((m) => !m)}
                className={compact ? 'w-full' : 'max-h-full'}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      <Sheet open={mobileList} onOpenChange={setMobileList}>
        <SheetContent side="left" showClose={false} className="w-[min(22rem,92vw)] p-0 sm:max-w-sm">
          <SheetTitle className="sr-only">Vehicles</SheetTitle>
          {list}
        </SheetContent>
      </Sheet>

      {selectedId && (
        <>
          <JourneyHistoryDialog vehicleId={selectedId} open={historyOpen} onOpenChange={setHistoryOpen} />
          <AssignVehicleDialog vehicleId={selectedId} open={assignOpen} onOpenChange={setAssignOpen} />
        </>
      )}
    </div>
  )
}
