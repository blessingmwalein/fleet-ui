import * as React from 'react'
import type { FeatureCollection } from 'geojson'
import { maplibregl } from './maplibre'
import { ROUTE_BY_ID, sliceCoords } from '@/data/routes'
import { fixBuffer } from '@/services/simulation'
import { lerpAngle } from '@/lib/geo'
import { useIsDark } from '@/hooks/useIsDark'
import { cn } from '@/lib/utils'
import { BASE_STYLES, MAP_COLORS, ZIM_CENTER } from './mapStyle'

export interface MiniMapMarker {
  id: string
  lat: number
  lng: number
  kind: 'origin' | 'destination' | 'depot' | 'incident' | 'customer' | 'pin'
  label?: string
}

export interface MiniMapProps {
  height?: number | string
  markers?: MiniMapMarker[]
  /** Draw a predefined road-following route (see data/routes.ts) */
  routeId?: string
  /** metres already travelled along the route (from route start in direction of travel) */
  progressM?: number
  routeDir?: 1 | -1
  /** Or draw any polyline ([lng,lat] pairs) */
  line?: [number, number][]
  /** Show a live, animated vehicle marker driven by simulated telemetry */
  vehicleId?: string
  /** keep the live vehicle centred */
  follow?: boolean
  center?: { lat: number; lng: number }
  zoom?: number
  interactive?: boolean
  className?: string
}

const KIND_STYLE: Record<MiniMapMarker['kind'], { bg: string; glyph: string }> = {
  origin: { bg: MAP_COLORS.primary, glyph: '●' },
  destination: { bg: MAP_COLORS.danger, glyph: '⚑' },
  depot: { bg: MAP_COLORS.info, glyph: '⌂' },
  incident: { bg: MAP_COLORS.danger, glyph: '!' },
  customer: { bg: MAP_COLORS.warning, glyph: '◆' },
  pin: { bg: MAP_COLORS.muted, glyph: '•' },
}

function markerEl(m: MiniMapMarker) {
  const s = KIND_STYLE[m.kind]
  const el = document.createElement('div')
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:auto;'
  const dot = document.createElement('div')
  dot.textContent = s.glyph
  dot.style.cssText = `width:22px;height:22px;border-radius:50%;background:${s.bg};color:#06130b;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #0c0e11;box-shadow:0 2px 6px rgba(0,0,0,.5);`
  el.appendChild(dot)
  if (m.label) {
    const t = document.createElement('div')
    t.textContent = m.label
    t.style.cssText = 'margin-top:3px;padding:1px 5px;border-radius:4px;background:rgba(12,14,17,.85);color:#e6e9ee;font:500 10.5px Inter,system-ui,sans-serif;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;'
    el.appendChild(t)
  }
  return el
}

function vehicleEl() {
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;width:30px;height:30px;'
  el.innerHTML = `<div style="position:absolute;inset:0;border-radius:50%;background:${MAP_COLORS.primary};opacity:.25"></div>
  <div data-arrow style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform .2s linear;">
    <svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="${MAP_COLORS.primary}" stroke="#06130b" stroke-width="1.6" stroke-linejoin="round"/></svg>
  </div>`
  return el
}

/**
 * Small, theme-aware MapLibre map: markers, route polyline (with travelled portion), custom polylines
 * and an optional live vehicle driven by the GPS simulator. Fits its content automatically.
 */
export function MiniMap({ height = 260, markers, routeId, progressM, routeDir = 1, line, vehicleId, follow, center, zoom, interactive = true, className }: MiniMapProps) {
  const container = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<maplibregl.Map | null>(null)
  const markerObjs = React.useRef<maplibregl.Marker[]>([])
  const vehicleMarker = React.useRef<maplibregl.Marker | null>(null)
  const fitKey = React.useRef('')
  const dark = useIsDark()
  const props = React.useRef({ markers, routeId, progressM, routeDir, line, follow })
  props.current = { markers, routeId, progressM, routeDir, line, follow }

  const drawNow = React.useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const { markers, routeId, progressM, routeDir, line } = props.current
    const route = routeId ? ROUTE_BY_ID[routeId] : undefined
    const all: [number, number][] = []
    let remaining: [number, number][] | null = null
    let done: [number, number][] | null = null
    if (route) {
      const full = route.coords
      all.push(...full)
      const travelled = progressM !== undefined ? Math.max(0, Math.min(route.lengthM, progressM)) : 0
      const split = routeDir === 1 ? travelled : route.lengthM - travelled
      if (progressM !== undefined && travelled > 0) {
        done = routeDir === 1 ? sliceCoords(route, 0, split) : sliceCoords(route, split, route.lengthM)
        remaining = routeDir === 1 ? sliceCoords(route, split, route.lengthM) : sliceCoords(route, 0, split)
      } else remaining = full
    } else if (line?.length) {
      remaining = line
      all.push(...line)
    }
    const fc = (c: [number, number][] | null): FeatureCollection => ({ type: 'FeatureCollection', features: c && c.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }] : [] })
    const color = dark ? MAP_COLORS.primary : MAP_COLORS.primaryLight
    const setSrc = (id: string, data: FeatureCollection) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    setSrc('mm-remaining', fc(remaining))
    setSrc('mm-done', fc(done))
    if (!map.getLayer('mm-done')) map.addLayer({ id: 'mm-done', type: 'line', source: 'mm-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': MAP_COLORS.traveled, 'line-width': 4, 'line-opacity': 0.9 } })
    if (!map.getLayer('mm-casing')) map.addLayer({ id: 'mm-casing', type: 'line', source: 'mm-remaining', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0c0e11' : '#ffffff', 'line-width': 7, 'line-opacity': 0.7 } })
    if (!map.getLayer('mm-remaining')) map.addLayer({ id: 'mm-remaining', type: 'line', source: 'mm-remaining', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 3.5 } })
    else map.setPaintProperty('mm-remaining', 'line-color', color)

    markerObjs.current.forEach((m) => m.remove())
    markerObjs.current = (markers ?? []).map((m) => {
      all.push([m.lng, m.lat])
      return new maplibregl.Marker({ element: markerEl(m), anchor: 'bottom' }).setLngLat([m.lng, m.lat]).addTo(map)
    })

    const live = vehicleId ? fixBuffer.get(vehicleId)?.curr : undefined
    if (live) all.push([live.lng, live.lat])
    const key = `${routeId ?? ''}|${line?.length ?? 0}|${markers?.map((m) => m.id).join(',') ?? ''}|${vehicleId ?? ''}`
    if (key !== fitKey.current && all.length) {
      fitKey.current = key
      if (all.length === 1) map.jumpTo({ center: all[0]!, zoom: zoom ?? 13 })
      else {
        const b = new maplibregl.LngLatBounds(all[0]!, all[0]!)
        all.forEach((c) => b.extend(c))
        map.fitBounds(b, { padding: 44, maxZoom: 15, duration: 0 })
      }
    }
  }, [dark, vehicleId, zoom])

  /** Style may still be loading — swallow and retry on style.load / load. */
  const draw = React.useCallback(() => {
    try {
      drawNow()
    } catch {
      /* style not ready yet */
    }
  }, [drawNow])

  // init
  React.useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current,
      style: BASE_STYLES[dark ? 'dark' : 'light'],
      center: center ? [center.lng, center.lat] : ZIM_CENTER,
      zoom: zoom ?? (center ? 12 : 5),
      interactive,
      attributionControl: { compact: true },
      cooperativeGestures: interactive,
    })
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    map.on('style.load', draw)
    map.on('load', draw)
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container.current)
    return () => {
      ro.disconnect()
      markerObjs.current.forEach((m) => m.remove())
      vehicleMarker.current?.remove()
      vehicleMarker.current = null
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // theme switch
  React.useEffect(() => {
    const map = mapRef.current
    if (map) map.setStyle(BASE_STYLES[dark ? 'dark' : 'light'])
  }, [dark])

  // redraw on data change
  React.useEffect(() => {
    draw()
  }, [draw, markers, routeId, progressM, routeDir, line])

  // live vehicle animation (interpolates between simulated GPS fixes)
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !vehicleId) return
    let raf = 0
    let heading = 0
    const frame = () => {
      const f = fixBuffer.get(vehicleId)
      if (f) {
        const span = Math.max(300, f.curr.at - f.prev.at || 2000)
        const t = Math.max(0, Math.min(1, (Date.now() - f.curr.at) / span + 0))
        // render one interval behind: lerp prev → curr as time passes since curr arrived
        const lng = f.prev.lng + (f.curr.lng - f.prev.lng) * t
        const lat = f.prev.lat + (f.curr.lat - f.prev.lat) * t
        heading = lerpAngle(heading, f.curr.heading, 0.25)
        if (!vehicleMarker.current) {
          vehicleMarker.current = new maplibregl.Marker({ element: vehicleEl() }).setLngLat([lng, lat]).addTo(map)
        } else vehicleMarker.current.setLngLat([lng, lat])
        const arrow = vehicleMarker.current.getElement().querySelector<HTMLElement>('[data-arrow]')
        if (arrow) arrow.style.transform = `rotate(${heading}deg)`
        if (props.current.follow) map.easeTo({ center: [lng, lat], duration: 250, easing: (x: number) => x })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      vehicleMarker.current?.remove()
      vehicleMarker.current = null
    }
  }, [vehicleId])

  return <div ref={container} style={{ height }} className={cn('relative w-full overflow-hidden rounded-lg border border-border bg-surface-2', className)} />
}
