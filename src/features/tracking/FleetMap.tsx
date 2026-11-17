import * as React from 'react'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { maplibregl, type MapLibreMap } from '@/components/map/maplibre'
import { BASE_STYLES, ZIM_CENTER, ZIM_ZOOM, type BaseMapId } from '@/components/map/mapStyle'
import { ROUTE_BY_ID, routeEndpoints, sliceCoords } from '@/data/routes'
import { fixBuffer } from '@/services/simulation'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { haversineM, lerpAngle } from '@/lib/geo'
import {
  EMPTY, VEHICLE_LAYERS, labelOpacity, addGeofenceLabels, addGeofenceLayers, addRouteLayers, addSelectionLayers, addTrafficLayer, addVehicleLayers, firstSymbolId, refreshTraffic, removeVehicleLayers, setVehicleData, setVis, updateGeofences, updateSelection,
} from './mapLayers'
import { addMarkerImages } from './markerImages'

export interface FleetMapOptions {
  vehicles: boolean
  labels: boolean
  speed: boolean
  cluster: boolean
  geofences: boolean
  routes: boolean
  traffic: boolean
  trail: boolean
}

export const DEFAULT_MAP_OPTIONS: FleetMapOptions = { vehicles: true, labels: false, speed: false, cluster: true, geofences: true, routes: true, traffic: false, trail: true }

export interface FleetMapHandle {
  fitAll: () => void
  locate: (id: string) => void
  flyTo: (lng: number, lat: number, zoom?: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetNorth: () => void
  toggleTilt: () => void
  resize: () => void
}

interface FleetMapProps {
  baseMap: BaseMapId
  options: FleetMapOptions
  selectedId: string | null
  onSelect: (id: string | null) => void
  follow: boolean
  /** rotate the map so the followed vehicle always points up */
  headingUp: boolean
  /** screen space covered by floating panels (px) — the camera centres the vehicle in the remaining area */
  insets: { right: number; bottom: number }
  onFollowBreak: () => void
  /** vehicle ids currently passing the list filters (null = all) */
  visibleIds: Set<string> | null
  searchMarker: { lng: number; lat: number; label: string } | null
  onBearing: (deg: number) => void
  onPitch: (deg: number) => void
  className?: string
}

interface Meta {
  reg: string
  category: string
  model: string
  driver: string
}

function hash32(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const FleetMap = React.forwardRef<FleetMapHandle, FleetMapProps>(function FleetMap(props, ref) {
  const container = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const propsRef = React.useRef(props)
  propsRef.current = props
  const ready = React.useRef(false)
  const meta = React.useRef(new Map<string, Meta>())
  const hdg = React.useRef(new Map<string, number>())
  const trails = React.useRef(new Map<string, [number, number][]>())
  const searchMarkerObj = React.useRef<InstanceType<typeof maplibregl.Marker> | null>(null)
  const fitted = React.useRef(false)
  const pendingFocus = React.useRef<string | null>(null)
  /** timestamp until which a fly-to animation owns the camera (follow-recentering must not interrupt it) */
  const flightUntil = React.useRef(0)
  const fly = (opts: Parameters<MapLibreMap['flyTo']>[0]) => {
    flightUntil.current = Date.now() + ((opts as { duration?: number }).duration ?? 1000) + 150
    mapRef.current?.flyTo(opts)
  }
  const pad = () => ({ top: 0, left: 0, right: propsRef.current.insets.right, bottom: propsRef.current.insets.bottom })
  const lastBase = React.useRef<BaseMapId | null>(null)
  const lastCluster = React.useRef<boolean>(props.options.cluster)

  const isLight = (b: BaseMapId) => b === 'light' || b === 'streets'

  // ---- vehicle metadata (reg, category, driver) ------------------------------------------------------------------
  const syncMeta = React.useCallback(() => {
    const { vehicles, drivers } = useDb.getState()
    const dn = new Map(drivers.map((d) => [d.id, d.name]))
    meta.current = new Map(vehicles.map((v) => [v.id, { reg: v.reg, category: v.category, model: `${v.make} ${v.model}`, driver: dn.get(v.driverId ?? '') ?? 'Unassigned' }]))
  }, [])

  // ---- data builders ----------------------------------------------------------------------------------------------
  const buildVehicles = React.useCallback((): FeatureCollection<Point> => {
    const p = propsRef.current
    const telemetry = useLive.getState().telemetry
    const now = Date.now()
    const features: Feature<Point>[] = []
    for (const [id, fx] of fixBuffer) {
      const m = meta.current.get(id)
      const t = telemetry[id]
      if (!m || !t) continue
      if (p.visibleIds && !p.visibleIds.has(id) && id !== p.selectedId) continue
      const span = Math.max(400, fx.curr.at - fx.prev.at)
      const k = fx.curr === fx.prev || fx.prev.at === fx.curr.at ? 1 : Math.max(0, Math.min(1, (now - fx.curr.at) / span))
      const lng = fx.prev.lng + (fx.curr.lng - fx.prev.lng) * k
      const lat = fx.prev.lat + (fx.curr.lat - fx.prev.lat) * k
      const h = lerpAngle(hdg.current.get(id) ?? fx.curr.heading, fx.curr.heading, 0.2)
      hdg.current.set(id, h)
      const selected = id === p.selectedId
      const phase = (hash32(id) % 1000) / 1000
      features.push({
        type: 'Feature',
        properties: { id, reg: m.reg, category: m.category, model: m.model, drv: m.driver, state: t.state, speed: t.speedKph, heading: Math.round(h), pulse: ((now / 1700 + phase) % 1), selected: selected ? 1 : 0, sort: selected ? 10 : t.state === 'moving' ? 2 : 1 },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      })
      if (selected && p.follow && Date.now() > flightUntil.current) mapRef.current?.jumpTo(p.headingUp ? { center: [lng, lat], bearing: h, padding: pad() } : { center: [lng, lat], padding: pad() })
    }
    return { type: 'FeatureCollection', features }
  }, [])

  const pushSelection = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const { selectedId, options } = propsRef.current
    const t = selectedId ? useLive.getState().telemetry[selectedId] : null
    if (!selectedId || !t || !t.routeId || !ROUTE_BY_ID[t.routeId]) {
      updateSelection(map, selectedId && options.trail ? { done: null, remaining: null, trail: trails.current.get(selectedId) ?? null, endpoints: [] } : null)
      return
    }
    const route = ROUTE_BY_ID[t.routeId]!
    const progress = Math.max(0, Math.min(route.lengthM, t.progressM))
    const split = t.routeDir === 1 ? progress : route.lengthM - progress
    const done = progress > 20 ? (t.routeDir === 1 ? sliceCoords(route, 0, split) : sliceCoords(route, split, route.lengthM)) : null
    // ordered in the direction of travel so the chevrons point where the vehicle is heading
    const remaining = t.routeDir === 1 ? sliceCoords(route, split, route.lengthM) : sliceCoords(route, 0, split).reverse()
    const trip = t.tripId ? useDb.getState().trips.find((x) => x.id === t.tripId) : null
    const ep = routeEndpoints(route, t.routeDir)
    updateSelection(map, {
      done,
      remaining,
      trail: options.trail ? (trails.current.get(selectedId) ?? null) : null,
      endpoints: [
        { lng: ep.from.lng, lat: ep.from.lat, role: 'origin', label: trip?.origin.name ?? ep.fromName },
        { lng: ep.to.lng, lat: ep.to.lat, role: 'destination', label: trip?.destination.name ?? ep.toName },
      ],
    })
  }, [])

  const applyOptions = React.useCallback(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const o = propsRef.current.options
    setVis(map, ['geo-fill', 'geo-line', 'geo-label'], o.geofences)
    setVis(map, ['all-routes'], o.routes)
    setVis(map, ['traffic'], o.traffic)
    setVis(map, VEHICLE_LAYERS, o.vehicles)
    if (map.getLayer('veh-speed')) map.setLayoutProperty('veh-speed', 'visibility', o.vehicles && o.speed ? 'visible' : 'none')
    if (map.getLayer('veh-label')) map.setPaintProperty('veh-label', 'text-opacity', labelOpacity(o.labels) as never)
  }, [])

  // ---- (re)build every overlay; runs after each style load -----------------------------------------------------------
  const setup = React.useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    try {
      await addMarkerImages(map)
      const light = isLight(propsRef.current.baseMap)
      const before = firstSymbolId(map)
      const fences = useDb.getState().geofences
      addGeofenceLayers(map, fences, before)
      addRouteLayers(map, { light }, before)
      addTrafficLayer(map, before)
      addGeofenceLabels(map, { light })
      addSelectionLayers(map, { light })
      removeVehicleLayers(map)
      addVehicleLayers(map, { cluster: propsRef.current.options.cluster, labels: propsRef.current.options.labels, speed: propsRef.current.options.speed, light }, buildVehicles())
      ready.current = true
      applyOptions()
      pushSelection()
    } catch (e) {
      // style may have been swapped again mid-setup; the next style.load will retry
      if (import.meta.env.DEV) console.debug('[tracking] setup retry', e)
    }
  }, [applyOptions, buildVehicles, pushSelection])

  // ---- init ---------------------------------------------------------------------------------------------------------
  React.useEffect(() => {
    if (!container.current) return
    syncMeta()
    const p = propsRef.current
    const map = new maplibregl.Map({
      container: container.current,
      style: BASE_STYLES[p.baseMap],
      center: ZIM_CENTER,
      zoom: ZIM_ZOOM,
      minZoom: 3,
      maxPitch: 60,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: true,
    })
    mapRef.current = map
    ;(window as unknown as { __fleetMap?: MapLibreMap }).__fleetMap = map // handy for diagnostics / e2e probes
    lastBase.current = p.baseMap
    map.on('style.load', () => {
      ready.current = false
      void setup()
    })
    map.on('rotate', () => propsRef.current.onBearing(Math.round(map.getBearing())))
    map.on('pitch', () => propsRef.current.onPitch(Math.round(map.getPitch())))
    map.on('dragstart', (e) => {
      if ((e as unknown as { originalEvent?: Event }).originalEvent && propsRef.current.follow) propsRef.current.onFollowBreak()
    })

    // selection / cluster expansion
    map.on('click', async (e) => {
      const layers = ['veh-body', 'veh-cluster'].filter((id) => map.getLayer(id))
      const f = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined
      if (!f) {
        propsRef.current.onSelect(null)
        return
      }
      if (f.properties?.cluster) {
        const src = map.getSource('vehicles') as unknown as { getClusterExpansionZoom: (id: number) => Promise<number> }
        const zoom = await src.getClusterExpansionZoom(Number(f.properties.cluster_id))
        map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: zoom + 0.5, duration: 600 })
      } else propsRef.current.onSelect(String(f.properties?.id))
    })
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 26, maxWidth: '240px' })
    map.on('mousemove', 'veh-body', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      const pr = f.properties as Record<string, string | number>
      popup
        .setLngLat((f.geometry as Point).coordinates as [number, number])
        .setHTML(`<div style="font:600 12px Inter,system-ui,sans-serif">${pr.reg}</div><div style="font:11px Inter,system-ui,sans-serif;opacity:.75">${pr.model}</div><div style="font:11px Inter,system-ui,sans-serif;margin-top:2px">${pr.drv} · ${pr.speed} km/h</div>`)
        .addTo(map)
    })
    map.on('mouseleave', 'veh-body', () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    })
    map.on('mouseenter', 'veh-cluster', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'veh-cluster', () => (map.getCanvas().style.cursor = ''))

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container.current)

    // animation loop — interpolates between GPS fixes
    let raf = 0
    let last = 0
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame)
      if (!ready.current || ts - last < 50) return
      last = ts
      setVehicleData(map, buildVehicles())
      const pf = pendingFocus.current
      if (pf && fixBuffer.has(pf) && propsRef.current.selectedId === pf) {
        pendingFocus.current = null
        fitted.current = true
        const fx0 = fixBuffer.get(pf)!
        fly({ center: [fx0.curr.lng, fx0.curr.lat], zoom: 14.2, duration: 1200, padding: pad(), essential: true })
      }
      if (!fitted.current && fixBuffer.size && !propsRef.current.selectedId) {
        fitted.current = true
        fitAll()
      }
    }
    raf = requestAnimationFrame(frame)

    // per-tick work: trails, selected-route progress
    const unsubLive = useLive.subscribe((s, prev) => {
      if (s.telemetry === prev.telemetry) return
      for (const id in s.telemetry) {
        const t = s.telemetry[id]!
        if (t.state !== 'moving') continue
        const tr = trails.current.get(id) ?? []
        const lastPt = tr[tr.length - 1]
        if (!lastPt || haversineM({ lat: lastPt[1], lng: lastPt[0] }, t) > 40) {
          tr.push([t.lng, t.lat])
          if (tr.length > 400) tr.shift()
          trails.current.set(id, tr)
        }
      }
      pushSelection()
    })
    let lastDb = useDb.getState()
    const unsubDb = useDb.subscribe((s) => {
      if (s.vehicles !== lastDb.vehicles || s.drivers !== lastDb.drivers) syncMeta()
      if (s.geofences !== lastDb.geofences && mapRef.current && ready.current) updateGeofences(mapRef.current, s.geofences)
      lastDb = s
    })
    const trafficTimer = setInterval(() => ready.current && refreshTraffic(map), 20_000)

    function fitAll() {
      const b = new maplibregl.LngLatBounds()
      let n = 0
      for (const [id, fx] of fixBuffer) {
        const vis = propsRef.current.visibleIds
        if (vis && !vis.has(id)) continue
        b.extend([fx.curr.lng, fx.curr.lat])
        n++
      }
      if (n) map.fitBounds(b, { padding: { top: 70, bottom: 70, left: 60, right: 60 }, maxZoom: 12, duration: 900 })
    }
    ;(map as unknown as { __fitAll: () => void }).__fitAll = fitAll

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(trafficTimer)
      unsubLive()
      unsubDb()
      ro.disconnect()
      searchMarkerObj.current?.remove()
      popup.remove()
      map.remove()
      mapRef.current = null
      ready.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- base map change ------------------------------------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || lastBase.current === props.baseMap) return
    lastBase.current = props.baseMap
    ready.current = false
    map.setStyle(BASE_STYLES[props.baseMap])
  }, [props.baseMap])

  // ---- options (visibility, clustering) ---------------------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    if (lastCluster.current !== props.options.cluster) {
      lastCluster.current = props.options.cluster
      removeVehicleLayers(map)
      addVehicleLayers(map, { cluster: props.options.cluster, labels: props.options.labels, speed: props.options.speed, light: isLight(props.baseMap) }, buildVehicles())
    }
    applyOptions()
    pushSelection()
  }, [props.options, props.baseMap, applyOptions, buildVehicles, pushSelection])

  // ---- selection changed → fly to vehicle ---------------------------------------------------------------------------------
  React.useEffect(() => {
    pushSelection()
    const map = mapRef.current
    if (!map || !props.selectedId) return
    const fx = fixBuffer.get(props.selectedId)
    if (fx) fly({ center: [fx.curr.lng, fx.curr.lat], zoom: Math.max(map.getZoom(), 14.2), duration: 1100, padding: pad(), essential: true })
    else pendingFocus.current = props.selectedId
  }, [props.selectedId, pushSelection])

  // ---- search marker ------------------------------------------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current
    searchMarkerObj.current?.remove()
    searchMarkerObj.current = null
    if (!map || !props.searchMarker) return
    const el = document.createElement('div')
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:18px;height:18px;border-radius:50%;background:#6b9bf2;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div><div style="margin-top:3px;padding:2px 6px;border-radius:5px;background:rgba(12,14,17,.9);color:#e6e9ee;font:500 11px Inter,system-ui,sans-serif;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis">${props.searchMarker.label.replace(/</g, '&lt;')}</div></div>`
    searchMarkerObj.current = new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([props.searchMarker.lng, props.searchMarker.lat]).addTo(map)
  }, [props.searchMarker])

  // ---- imperative API ----------------------------------------------------------------------------------------------------
  React.useImperativeHandle(
    ref,
    () => ({
      fitAll: () => (mapRef.current as unknown as { __fitAll?: () => void })?.__fitAll?.(),
      locate: (id) => {
        const fx = fixBuffer.get(id)
        if (fx && mapRef.current) fly({ center: [fx.curr.lng, fx.curr.lat], zoom: Math.max(mapRef.current.getZoom(), 14.2), duration: 900, padding: pad() })
      },
      flyTo: (lng, lat, zoom = 13) => mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1100 }),
      zoomIn: () => mapRef.current?.zoomIn({ duration: 250 }),
      zoomOut: () => mapRef.current?.zoomOut({ duration: 250 }),
      resetNorth: () => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 }),
      toggleTilt: () => {
        const m = mapRef.current
        if (m) m.easeTo({ pitch: m.getPitch() > 5 ? 0 : 55, duration: 600 })
      },
      resize: () => mapRef.current?.resize(),
    }),
    [],
  )

  void EMPTY
  // MapLibre's stylesheet forces `position: relative` on its container, so size it through an absolutely-positioned wrapper.
  return (
    <div className={props.className ?? 'absolute inset-0'}>
      <div ref={container} className="size-full" aria-label="Live fleet map" role="application" />
    </div>
  )
})
