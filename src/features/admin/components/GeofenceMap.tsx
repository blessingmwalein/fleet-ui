import * as React from 'react'
import type { FeatureCollection } from 'geojson'
import { maplibregl } from '@/components/map/maplibre'
import { BASE_STYLES, MAP_COLORS, ZIM_CENTER } from '@/components/map/mapStyle'
import { useIsDark } from '@/hooks/useIsDark'
import { cn } from '@/lib/utils'
import type { Geofence, GeofenceKind } from '@/types'

export const KIND_COLOR: Record<GeofenceKind, string> = { depot: MAP_COLORS.info, customer: MAP_COLORS.warning, restricted: MAP_COLORS.danger, border: '#9b8afb', city: MAP_COLORS.muted }

/** Ring of [lng, lat] points approximating a circle of `rM` metres. */
export function circleRing(lat: number, lng: number, rM: number, steps = 48): [number, number][] {
  const pts: [number, number][] = []
  const dLat = (rM / 6371000) * (180 / Math.PI)
  const dLng = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    pts.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)])
  }
  return pts
}

export interface DraftFence {
  lat: number
  lng: number
  radiusM: number
}

interface Props {
  fences?: Geofence[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  draft?: DraftFence | null
  /** When set, clicking the map (or dragging the pin) reports a position — used by the location pickers in forms. */
  onPick?: (lat: number, lng: number) => void
  height?: number
  className?: string
}

const blankStyle = (dark: boolean) => ({ version: 8 as const, sources: {}, layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': dark ? '#10141a' : '#e9eef3' } }] })

/** Theme-aware MapLibre map that draws geofence circles, with optional click-to-select and click-to-pick modes. */
export default function GeofenceMap({ fences = [], selectedId, onSelect, draft, onPick, height = 320, className }: Props) {
  const el = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<maplibregl.Map | null>(null)
  const pin = React.useRef<maplibregl.Marker | null>(null)
  const ready = React.useRef(false)
  const fallback = React.useRef(false)
  const fitted = React.useRef('')
  const lastPick = React.useRef<string>('')
  const dark = useIsDark()
  const latest = React.useRef({ fences, selectedId, onSelect, draft, onPick })
  latest.current = { fences, selectedId, onSelect, draft, onPick }

  const draw = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    try {
      const { fences, selectedId, draft } = latest.current
      const polys: FeatureCollection = {
        type: 'FeatureCollection',
        features: fences.map((g) => ({ type: 'Feature', properties: { id: g.id, color: KIND_COLOR[g.kind], sel: g.id === selectedId ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [circleRing(g.lat, g.lng, g.radiusM)] } })),
      }
      const pts: FeatureCollection = {
        type: 'FeatureCollection',
        features: fences.map((g) => ({ type: 'Feature', properties: { id: g.id, color: KIND_COLOR[g.kind], sel: g.id === selectedId ? 1 : 0 }, geometry: { type: 'Point', coordinates: [g.lng, g.lat] } })),
      }
      const draftFc: FeatureCollection = {
        type: 'FeatureCollection',
        features: draft ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(draft.lat, draft.lng, Math.max(20, draft.radiusM))] } }] : [],
      }
      const setSrc = (id: string, data: FeatureCollection) => {
        const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined
        if (s) s.setData(data)
        else map.addSource(id, { type: 'geojson', data })
      }
      setSrc('gf-polys', polys)
      setSrc('gf-pts', pts)
      setSrc('gf-draft', draftFc)
      if (!map.getLayer('gf-fill')) map.addLayer({ id: 'gf-fill', type: 'fill', source: 'gf-polys', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.42, 0.18] } })
      if (!map.getLayer('gf-line')) map.addLayer({ id: 'gf-line', type: 'line', source: 'gf-polys', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 1.4] } })
      if (!map.getLayer('gf-dot')) map.addLayer({ id: 'gf-dot', type: 'circle', source: 'gf-pts', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 7, 4.5], 'circle-stroke-width': 1.5, 'circle-stroke-color': dark ? '#0c0e11' : '#ffffff' } })
      if (!map.getLayer('gf-draft-fill')) map.addLayer({ id: 'gf-draft-fill', type: 'fill', source: 'gf-draft', paint: { 'fill-color': MAP_COLORS.primary, 'fill-opacity': 0.25 } })
      if (!map.getLayer('gf-draft-line')) map.addLayer({ id: 'gf-draft-line', type: 'line', source: 'gf-draft', paint: { 'line-color': MAP_COLORS.primary, 'line-width': 2, 'line-dasharray': [2, 1.5] } })

      // draft pin
      if (draft) {
        if (!pin.current) {
          pin.current = new maplibregl.Marker({ color: MAP_COLORS.primaryLight, draggable: !!latest.current.onPick }).setLngLat([draft.lng, draft.lat]).addTo(map)
          pin.current.on('dragend', () => {
            const ll = pin.current!.getLngLat()
            lastPick.current = `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`
            latest.current.onPick?.(ll.lat, ll.lng)
          })
        } else pin.current.setLngLat([draft.lng, draft.lat])
      } else if (pin.current) {
        pin.current.remove()
        pin.current = null
      }

      // camera
      const sel = fences.find((g) => g.id === selectedId)
      const key = draft ? `d:${draft.lat.toFixed(5)},${draft.lng.toFixed(5)}` : sel ? `s:${sel.id}` : `a:${fences.length}`
      if (key !== fitted.current) {
        const first = fitted.current === ''
        fitted.current = key
        if (draft) {
          if (lastPick.current !== key.slice(2)) map.easeTo({ center: [draft.lng, draft.lat], zoom: Math.max(map.getZoom(), first ? 11 : 9), duration: first ? 0 : 500 })
        } else if (sel) {
          const ring = circleRing(sel.lat, sel.lng, sel.radiusM)
          const b = new maplibregl.LngLatBounds(ring[0]!, ring[0]!)
          ring.forEach((c) => b.extend(c))
          map.fitBounds(b, { padding: 70, maxZoom: 14, duration: first ? 0 : 600 })
        } else if (fences.length) {
          const b = new maplibregl.LngLatBounds([fences[0]!.lng, fences[0]!.lat], [fences[0]!.lng, fences[0]!.lat])
          fences.forEach((g) => b.extend([g.lng, g.lat]))
          map.fitBounds(b, { padding: 40, maxZoom: 7, duration: 0 })
        }
      }
    } catch {
      /* style still loading — retried on style.load */
    }
  }, [dark])

  React.useEffect(() => {
    if (!el.current) return
    const map = new maplibregl.Map({ container: el.current, style: BASE_STYLES[dark ? 'dark' : 'light'], center: ZIM_CENTER, zoom: 5, attributionControl: { compact: true }, cooperativeGestures: !onPick })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    const onStyle = () => {
      ready.current = true
      draw()
    }
    map.on('style.load', onStyle)
    map.on('load', onStyle)
    // offline / blocked tile server: fall back to a plain background so the geofences still render
    map.on('error', () => {
      if (!ready.current && !fallback.current) {
        fallback.current = true
        map.setStyle(blankStyle(dark) as never)
      }
    })
    const pick = (e: maplibregl.MapMouseEvent) => {
      if (latest.current.onPick) {
        lastPick.current = `${e.lngLat.lat.toFixed(5)},${e.lngLat.lng.toFixed(5)}`
        latest.current.onPick(e.lngLat.lat, e.lngLat.lng)
      }
    }
    map.on('click', pick)
    const select = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id && !latest.current.onPick) latest.current.onSelect?.(id)
    }
    map.on('click', 'gf-fill', select)
    map.on('click', 'gf-dot', select)
    for (const l of ['gf-fill', 'gf-dot']) {
      map.on('mouseenter', l, () => { if (latest.current.onSelect) map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = latest.current.onPick ? 'crosshair' : '' })
    }
    if (onPick) map.getCanvas().style.cursor = 'crosshair'
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      pin.current?.remove()
      pin.current = null
      ready.current = false
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ready.current = false
    fitted.current = ''
    fallback.current = false
    map.setStyle(BASE_STYLES[dark ? 'dark' : 'light'])
  }, [dark])

  React.useEffect(() => {
    draw()
  }, [draw, fences, selectedId, draft?.lat, draft?.lng, draft?.radiusM])

  return <div ref={el} style={{ height }} className={cn('relative w-full overflow-hidden rounded-lg border border-border bg-surface-2', className)} />
}
