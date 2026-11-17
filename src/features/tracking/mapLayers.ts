import type { FeatureCollection, Feature, LineString, Point, Polygon } from 'geojson'
import { circle } from '@turf/circle'
import type { Geofence } from '@/types'
import { ROUTES, type Route } from '@/data/routes'
import { hashString } from '@/lib/rng'
import { LABEL_FONT, MAP_COLORS } from '@/components/map/mapStyle'
import type { MapLibreMap } from '@/components/map/maplibre'

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

export const GEO_COLORS: Record<Geofence['kind'], string> = {
  depot: '#6b9bf2',
  customer: '#f2a93b',
  restricted: '#f0605d',
  border: '#9b8afb',
  city: '#8a93a1',
}

/** Id of the first symbol layer in the loaded base style — overlays are inserted beneath it so place/road names stay on top. */
export function firstSymbolId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id
}

const setData = (map: MapLibreMap, id: string, data: FeatureCollection) => {
  const src = map.getSource(id) as { setData?: (d: FeatureCollection) => void } | undefined
  if (src?.setData) src.setData(data)
}

export interface LayerTheme {
  /** true when the basemap is light (dark text) */
  light: boolean
}

// ---------------------------------------------------------------------------
// Geofences
// ---------------------------------------------------------------------------
export function geofenceCollection(fences: Geofence[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: fences.map((g) => {
      const poly = circle([g.lng, g.lat], g.radiusM / 1000, { steps: 56, units: 'kilometers' })
      poly.properties = { id: g.id, name: g.name, kind: g.kind, color: GEO_COLORS[g.kind] }
      return poly
    }),
  }
}

export function addGeofenceLayers(map: MapLibreMap, fences: Geofence[], before?: string) {
  if (!map.getSource('geofences')) map.addSource('geofences', { type: 'geojson', data: geofenceCollection(fences) })
  if (!map.getLayer('geo-fill')) map.addLayer({ id: 'geo-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'restricted'], 0.16, 0.12] } }, before)
  if (!map.getLayer('geo-line')) map.addLayer({ id: 'geo-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } }, before)
}

export function addGeofenceLabels(map: MapLibreMap, t: LayerTheme) {
  if (map.getLayer('geo-label')) return
  map.addLayer({
    id: 'geo-label',
    type: 'symbol',
    source: 'geofences',
    minzoom: 9,
    layout: { 'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 10.5, 'text-anchor': 'center', 'text-max-width': 8 },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': t.light ? '#ffffff' : '#0c0e11', 'text-halo-width': 1.4 },
  })
}

export const updateGeofences = (map: MapLibreMap, fences: Geofence[]) => setData(map, 'geofences', geofenceCollection(fences))

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
function routeCollection(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: ROUTES.map((r) => ({ type: 'Feature', properties: { id: r.id, name: r.name, kind: r.kind }, geometry: { type: 'LineString', coordinates: r.coords } })),
  }
}

export function addRouteLayers(map: MapLibreMap, t: LayerTheme, before?: string) {
  if (!map.getSource('all-routes')) map.addSource('all-routes', { type: 'geojson', data: routeCollection() })
  if (!map.getLayer('all-routes')) map.addLayer({ id: 'all-routes', type: 'line', source: 'all-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.light ? '#4b5563' : '#a3adbb', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 11, 4], 'line-opacity': 0.42, 'line-dasharray': [1, 1.4] } }, before)
}

// ---------------------------------------------------------------------------
// Simulated traffic (clearly labelled as demo in the UI)
// ---------------------------------------------------------------------------
function congestion(route: Route, seg: number, tMin: number): number {
  const seed = hashString(`${route.id}:${seg}`) % 997
  const slow = 0.5 + 0.5 * Math.sin(seed + tMin * 0.045)
  const fast = 0.5 + 0.5 * Math.sin(seed * 1.7 + tMin * 0.13)
  let v = 0.65 * slow + 0.35 * fast
  const hour = (new Date().getUTCHours() + 2) % 24 // CAT
  const peak = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 18)
  if (route.kind === 'city') v += peak ? 0.22 : 0.05
  else v *= 0.78
  return v < 0.58 ? 0 : v < 0.8 ? 1 : 2
}

export function trafficCollection(now = Date.now()): FeatureCollection<LineString> {
  const tMin = now / 60000
  const features: Feature<LineString>[] = []
  for (const r of ROUTES) {
    const step = r.kind === 'city' ? 1800 : 7000
    let start = 0
    let seg = 0
    while (start < r.lengthM) {
      const end = Math.min(r.lengthM, start + step)
      const coords: [number, number][] = []
      for (let i = 0; i < r.coords.length; i++) {
        const d = r.cum[i]!
        if (d >= start && d <= end) coords.push(r.coords[i]!)
        if (d > end) {
          // include the vertex that crosses the segment end to keep the line continuous
          if (coords.length) coords.push(r.coords[i]!)
          break
        }
      }
      if (coords.length > 1) features.push({ type: 'Feature', properties: { level: congestion(r, seg, tMin) }, geometry: { type: 'LineString', coordinates: coords } })
      start = end
      seg++
    }
  }
  return { type: 'FeatureCollection', features }
}

export function addTrafficLayer(map: MapLibreMap, before?: string) {
  if (!map.getSource('traffic')) map.addSource('traffic', { type: 'geojson', data: trafficCollection() })
  if (!map.getLayer('traffic')) {
    map.addLayer(
      {
        id: 'traffic',
        type: 'line',
        source: 'traffic',
        layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['match', ['get', 'level'], 0, '#34d17a', 1, '#f2a93b', '#f0605d'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 5.5], 'line-opacity': 0.85 },
      },
      before,
    )
  }
}

export const refreshTraffic = (map: MapLibreMap) => setData(map, 'traffic', trafficCollection())

// ---------------------------------------------------------------------------
// Selected vehicle: route progress, endpoints, trail
// ---------------------------------------------------------------------------
/** Line width that grows with zoom - the highlighted path stays bold at every scale. */
const boldWidth = (low: number, mid: number, high: number) => ['interpolate', ['linear'], ['zoom'], 5, low, 9, mid, 14, high] as never

export function addSelectionLayers(map: MapLibreMap, t: LayerTheme) {
  for (const id of ['sel-done', 'sel-remaining', 'sel-trail', 'sel-endpoints']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
  const primary = t.light ? MAP_COLORS.primaryLight : MAP_COLORS.primary
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const
  if (!map.getLayer('sel-glow')) map.addLayer({ id: 'sel-glow', type: 'line', source: 'sel-remaining', layout: round, paint: { 'line-color': primary, 'line-width': boldWidth(14, 22, 32), 'line-opacity': 0.26, 'line-blur': 7 } })
  if (!map.getLayer('sel-casing')) map.addLayer({ id: 'sel-casing', type: 'line', source: 'sel-remaining', layout: round, paint: { 'line-color': t.light ? '#ffffff' : '#0a0d10', 'line-width': boldWidth(9, 13, 18), 'line-opacity': 0.9 } })
  if (!map.getLayer('sel-done-casing')) map.addLayer({ id: 'sel-done-casing', type: 'line', source: 'sel-done', layout: round, paint: { 'line-color': t.light ? '#ffffff' : '#0a0d10', 'line-width': boldWidth(9, 13, 18), 'line-opacity': 0.8 } })
  if (!map.getLayer('sel-done')) map.addLayer({ id: 'sel-done', type: 'line', source: 'sel-done', layout: round, paint: { 'line-color': MAP_COLORS.traveled, 'line-width': boldWidth(5, 8, 11), 'line-opacity': 0.95 } })
  if (!map.getLayer('sel-remaining')) map.addLayer({ id: 'sel-remaining', type: 'line', source: 'sel-remaining', layout: round, paint: { 'line-color': primary, 'line-width': boldWidth(5, 8, 11) } })
  // chevrons along the remaining route, pointing in the direction of travel
  if (!map.getLayer('sel-arrows')) {
    map.addLayer({
      id: 'sel-arrows',
      type: 'symbol',
      source: 'sel-remaining',
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 64, 'icon-image': 'route-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 14, 0.85], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-keep-upright': false },
    })
  }
  if (!map.getLayer('sel-trail')) map.addLayer({ id: 'sel-trail', type: 'line', source: 'sel-trail', layout: round, paint: { 'line-color': '#b39dff', 'line-width': boldWidth(3, 4.5, 6), 'line-dasharray': [0.5, 1.6], 'line-opacity': 0.95 } })
  if (!map.getLayer('sel-endpoints')) {
    map.addLayer({ id: 'sel-endpoints', type: 'circle', source: 'sel-endpoints', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 7, 14, 11], 'circle-color': ['match', ['get', 'role'], 'origin', MAP_COLORS.primary, MAP_COLORS.danger], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } })
    map.addLayer({
      id: 'sel-endpoint-label',
      type: 'symbol',
      source: 'sel-endpoints',
      layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 12 },
      paint: { 'text-color': t.light ? '#12161c' : '#ffffff', 'text-halo-color': t.light ? '#ffffff' : '#0c0e11', 'text-halo-width': 1.8 },
    })
  }
}

export function updateSelection(map: MapLibreMap, sel: { done: [number, number][] | null; remaining: [number, number][] | null; trail: [number, number][] | null; endpoints: { lng: number; lat: number; role: 'origin' | 'destination'; label: string }[] } | null) {
  const line = (c: [number, number][] | null): FeatureCollection<LineString> => ({ type: 'FeatureCollection', features: c && c.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }] : [] })
  setData(map, 'sel-done', line(sel?.done ?? null))
  setData(map, 'sel-remaining', line(sel?.remaining ?? null))
  setData(map, 'sel-trail', line(sel?.trail ?? null))
  setData(map, 'sel-endpoints', {
    type: 'FeatureCollection',
    features: (sel?.endpoints ?? []).map<Feature<Point>>((e) => ({ type: 'Feature', properties: { role: e.role, label: e.label }, geometry: { type: 'Point', coordinates: [e.lng, e.lat] } })),
  })
}

// ---------------------------------------------------------------------------
// Vehicles (clustered or flat)
// ---------------------------------------------------------------------------
const UNCLUSTERED: ['!', ['has', string]] = ['!', ['has', 'point_count']]

/** Plates show when selected or zoomed in (zoom must be the input of a top-level step), or always when `always`. */
export function labelOpacity(always: boolean): number | unknown[] {
  return always ? 1 : ['step', ['zoom'], ['case', ['==', ['get', 'selected'], 1], 1, 0], 12.2, 1]
}

/** Vehicle artwork scales with zoom (small when zoomed out, large at street level) and grows when selected. */
export function vehicleIconSize() {
  const sel = ['case', ['==', ['get', 'selected'], 1], 1.4, 1]
  return ['interpolate', ['linear'], ['zoom'], 4, ['*', 0.5, sel], 8, ['*', 0.7, sel], 12, ['*', 1.05, sel], 16, ['*', 1.55, sel]] as never
}

export const VEHICLE_LAYERS = ['veh-cluster', 'veh-cluster-count', 'veh-pulse', 'veh-selected', 'veh-body', 'veh-label', 'veh-speed']

export function removeVehicleLayers(map: MapLibreMap) {
  for (const id of VEHICLE_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource('vehicles')) map.removeSource('vehicles')
}

export function addVehicleLayers(map: MapLibreMap, opts: { cluster: boolean; labels: boolean; speed: boolean; light: boolean }, data: FeatureCollection) {
  map.addSource('vehicles', { type: 'geojson', data, cluster: opts.cluster, clusterRadius: 30, clusterMaxZoom: 6 })
  const textColor = opts.light ? '#12161c' : '#ffffff'
  const halo = opts.light ? '#ffffff' : '#0c0e11'
  map.addLayer({ id: 'veh-cluster', type: 'circle', source: 'vehicles', filter: ['has', 'point_count'], paint: { 'circle-color': MAP_COLORS.primary, 'circle-opacity': 0.92, 'circle-radius': ['step', ['get', 'point_count'], 16, 4, 20, 10, 25], 'circle-stroke-width': 5, 'circle-stroke-color': 'rgba(52,209,122,0.28)' } })
  map.addLayer({ id: 'veh-cluster-count', type: 'symbol', source: 'vehicles', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': LABEL_FONT, 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#04130a' } })
  // animated halo for moving vehicles (the pulse property cycles 0 to 1 continuously)
  map.addLayer({
    id: 'veh-pulse',
    type: 'circle',
    source: 'vehicles',
    filter: ['all', UNCLUSTERED, ['==', ['get', 'state'], 'moving']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'pulse'], 0, 12, 1, ['case', ['==', ['get', 'selected'], 1], 46, 30]],
      'circle-color': MAP_COLORS.primary,
      'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse'], 0, ['case', ['==', ['get', 'selected'], 1], 0.42, 0.26], 1, 0],
    },
  })
  map.addLayer({ id: 'veh-selected', type: 'circle', source: 'vehicles', filter: ['all', UNCLUSTERED, ['==', ['get', 'selected'], 1]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 22, 10, 30, 15, 48], 'circle-color': 'rgba(52,209,122,0.12)', 'circle-stroke-color': MAP_COLORS.primary, 'circle-stroke-width': 2.5 } })
  map.addLayer({ id: 'veh-body', type: 'symbol', source: 'vehicles', filter: UNCLUSTERED, layout: { 'icon-image': ['concat', 'veh-', ['get', 'category'], '-', ['get', 'state']], 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-size': vehicleIconSize(), 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sort'] } })
  map.addLayer({
    id: 'veh-label',
    type: 'symbol',
    source: 'vehicles',
    filter: UNCLUSTERED,
    layout: { 'text-field': ['get', 'reg'], 'text-font': LABEL_FONT, 'text-size': 11.5, 'text-offset': [0, 3.1], 'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false },
    paint: {
      'text-color': textColor,
      'text-halo-color': halo,
      'text-halo-width': 1.8,
      'text-opacity': labelOpacity(opts.labels) as never,
    },
  })
  map.addLayer({
    id: 'veh-speed',
    type: 'symbol',
    source: 'vehicles',
    filter: ['all', UNCLUSTERED, ['>', ['get', 'speed'], 0]],
    layout: { 'text-field': ['concat', ['to-string', ['get', 'speed']], ' km/h'], 'text-font': LABEL_FONT, 'text-size': 10.5, 'text-offset': [0, -3.1], 'text-anchor': 'bottom', 'text-optional': true, visibility: opts.speed ? 'visible' : 'none' },
    paint: { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.6 },
  })
}

export const setVehicleData = (map: MapLibreMap, data: FeatureCollection) => setData(map, 'vehicles', data)

export const setVis = (map: MapLibreMap, ids: string[], on: boolean) => {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}
