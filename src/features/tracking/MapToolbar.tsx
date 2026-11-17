import * as React from 'react'
import { Box, Check, Compass, Crosshair, Navigation, Layers, Map as MapIcon, Maximize2, Minimize2, Minus, Pause, Play, Plus, Radio, ScanSearch } from 'lucide-react'
import type { LiveState } from '@/types'
import { LIVE_STATE } from '@/config/status'
import { BASE_MAP_LABELS, type BaseMapId } from '@/components/map/mapStyle'
import { useSettings } from '@/store/settings'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox, Label, Switch } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Segmented } from '@/components/ui/segmented'
import type { FleetMapOptions } from './FleetMap'
import { STATE_ORDER } from './useTrackingRows'

export type BaseChoice = 'auto' | BaseMapId

function ToolButton({ label, onClick, disabled, active, children }: { label: string; onClick?: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip content={label} side="left">
      <Button variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn('size-9 rounded-none text-foreground hover:bg-accent', active && 'bg-primary/15 text-primary')}>
        {children}
      </Button>
    </Tooltip>
  )
}

const OPTION_ROWS: { key: keyof FleetMapOptions; label: string; hint?: string }[] = [
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'labels', label: 'Registration labels', hint: 'Always show plates' },
  { key: 'speed', label: 'Speed indicators' },
  { key: 'cluster', label: 'Clustering', hint: 'Group vehicles when zoomed out' },
  { key: 'routes', label: 'Route polylines' },
  { key: 'geofences', label: 'Geofences' },
  { key: 'traffic', label: 'Traffic', hint: 'Simulated congestion (demo)' },
  { key: 'trail', label: 'Journey trail', hint: 'Breadcrumb of selected vehicle' },
]

export function MapToolbar({
  baseChoice, onBaseChoice, effectiveBase, options, onOptions, statusFilter, onStatusFilter, onFitAll, onLocate, canLocate, onZoomIn, onZoomOut, bearing, pitch, onResetNorth, onTilt, fullscreen, onFullscreen, headingUp, onHeadingUp, canHeadingUp,
}: {
  baseChoice: BaseChoice
  onBaseChoice: (b: BaseChoice) => void
  effectiveBase: BaseMapId
  options: FleetMapOptions
  onOptions: (patch: Partial<FleetMapOptions>) => void
  statusFilter: Set<LiveState>
  onStatusFilter: (s: Set<LiveState>) => void
  onFitAll: () => void
  onLocate: () => void
  canLocate: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  bearing: number
  pitch: number
  onResetNorth: () => void
  onTilt: () => void
  fullscreen: boolean
  onFullscreen: () => void
  headingUp: boolean
  onHeadingUp: () => void
  canHeadingUp: boolean
}) {
  return (
    <div className="pointer-events-auto flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/95 shadow-pop backdrop-blur" role="toolbar" aria-label="Map tools" aria-orientation="vertical">
      <DropdownMenu>
        <Tooltip content="Map style" side="left">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Map style" className="size-9 rounded-none hover:bg-accent"><MapIcon /></Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="left" align="start" className="w-44">
          <DropdownMenuLabel>Map style</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={baseChoice} onValueChange={(v) => onBaseChoice(v as BaseChoice)}>
            <DropdownMenuRadioItem value="auto">Auto (theme) <span className="ml-auto text-[11px] text-subtle-foreground">{BASE_MAP_LABELS[effectiveBase]}</span></DropdownMenuRadioItem>
            {(Object.keys(BASE_MAP_LABELS) as BaseMapId[]).map((b) => (
              <DropdownMenuRadioItem key={b} value={b}>{BASE_MAP_LABELS[b]}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <Tooltip content="Layers & visibility" side="left">
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Layers" className="size-9 rounded-none hover:bg-accent"><Layers /></Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="left" align="start" className="w-72 p-0">
          <div className="border-b border-border px-3 py-2.5 text-[13px] font-semibold">Layers</div>
          <ul className="divide-y divide-border/60">
            {OPTION_ROWS.map((o) => (
              <li key={o.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <Label htmlFor={`opt-${o.key}`} className="flex flex-col items-start gap-0 text-[13px] text-foreground">
                  {o.label}
                  {o.hint && <span className="text-[11px] font-normal text-subtle-foreground">{o.hint}</span>}
                </Label>
                <Switch id={`opt-${o.key}`} checked={options[o.key]} onCheckedChange={(v) => onOptions({ [o.key]: v })} />
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-3 py-2.5">
            <div className="label-xs mb-1.5">Show vehicles</div>
            <div className="grid grid-cols-2 gap-1.5">
              {STATE_ORDER.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={statusFilter.has(s)}
                    onCheckedChange={(v) => {
                      const n = new Set(statusFilter)
                      if (v) n.add(s)
                      else n.delete(s)
                      onStatusFilter(n)
                    }}
                  />
                  {LIVE_STATE[s].label}
                </label>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <ToolButton label="Fit all vehicles" onClick={onFitAll}><ScanSearch /></ToolButton>
      <ToolButton label="Locate selected vehicle" onClick={onLocate} disabled={!canLocate}><Crosshair /></ToolButton>
      <ToolButton label={headingUp ? 'Heading-up view: on' : 'Heading-up view (rotate map to vehicle heading)'} onClick={onHeadingUp} disabled={!canHeadingUp} active={headingUp}><Navigation /></ToolButton>
      <ToolButton label="Zoom in" onClick={onZoomIn}><Plus /></ToolButton>
      <ToolButton label="Zoom out" onClick={onZoomOut}><Minus /></ToolButton>
      <Tooltip content={`Reset north${bearing ? ` (${bearing}°)` : ''}`} side="left">
        <Button variant="ghost" size="icon" onClick={onResetNorth} aria-label="Reset north" className="size-9 rounded-none hover:bg-accent">
          <Compass style={{ transform: `rotate(${-bearing}deg)`, transition: 'transform 80ms linear' }} className={cn(bearing !== 0 && 'text-primary')} />
        </Button>
      </Tooltip>
      <ToolButton label={pitch > 5 ? 'Flat view' : '3D tilt'} onClick={onTilt} active={pitch > 5}><Box /></ToolButton>
      <ToolButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={onFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</ToolButton>
    </div>
  )
}

/** Bottom-left overlay: demo-data notice + simulation controls (pause, speed, GPS interval). */
export function SimControl({ running }: { running: boolean }) {
  const sim = useSettings((s) => s.simulation)
  const setSim = useSettings((s) => s.setSimulation)
  const live = sim.enabled
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-left text-[11.5px] shadow-pop outline-none backdrop-blur transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/40" aria-label="Simulation controls">
          <Radio className={cn('size-3.5', running && live ? 'text-primary' : 'text-subtle-foreground')} />
          <span className="font-medium">Demo data</span>
          <span className="text-muted-foreground">simulated GPS · {live ? `${sim.timeScale}×` : 'paused'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-semibold">GPS simulation</div>
          <Button size="sm" variant={live ? 'outline' : 'default'} onClick={() => setSim({ enabled: !live })}>
            {live ? <><Pause /> Pause</> : <><Play /> Resume</>}
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Positions are generated by a simulator moving vehicles along real road geometry. This is demo data, not live telemetry.</p>
        <div className="space-y-3">
          <div>
            <div className="label-xs mb-1.5">Speed-up</div>
            <Segmented size="sm" value={String(sim.timeScale)} onChange={(v) => setSim({ timeScale: Number(v) })} options={['1', '5', '12', '30', '60'].map((v) => ({ value: v, label: `${v}×` }))} />
          </div>
          <div>
            <div className="label-xs mb-1.5">GPS update interval</div>
            <Select value={String(sim.intervalMs)} onValueChange={(v) => setSim({ intervalMs: Number(v) })}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1000, 2000, 3000, 5000].map((ms) => <SelectItem key={ms} value={String(ms)}>Every {ms / 1000} s</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="sim-events" className="text-[13px] text-foreground">Generate alerts & events</Label>
            <Switch id="sim-events" checked={sim.events} onCheckedChange={(v) => setSim({ events: v })} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function MapLegend() {
  return (
    <div className="pointer-events-auto hidden items-center gap-3 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-pop backdrop-blur md:flex">
      {STATE_ORDER.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: { moving: '#34d17a', idle: '#f2a93b', stopped: '#6b9bf2', maintenance: '#9b8afb', offline: '#7d8794' }[s] }} />
          {LIVE_STATE[s].label}
        </span>
      ))}
      <Check className="hidden" />
    </div>
  )
}
