import { ROUTE_DEFS, type RouteDef } from './routes.generated'
import { bearingDeg, decodePolyline, haversineM } from '@/lib/geo'

export interface Route extends RouteDef {
  /** GeoJSON-ordered [lng, lat] */
  coords: [number, number][]
  /** cumulative distance in metres at each vertex */
  cum: number[]
  lengthM: number
}

function build(def: RouteDef): Route {
  const coords = decodePolyline(def.poly)
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!
    const b = coords[i]!
    cum.push(cum[i - 1]! + haversineM({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }))
  }
  return { ...def, coords, cum, lengthM: cum[cum.length - 1]! }
}

export const ROUTES: Route[] = ROUTE_DEFS.map(build)
export const ROUTE_BY_ID: Record<string, Route> = Object.fromEntries(ROUTES.map((r) => [r.id, r]))

export interface RoutePoint {
  lat: number
  lng: number
  /** heading in the direction of travel, degrees */
  heading: number
  segment: number
}

/**
 * Position along a route at `distM` metres from its start. `dir` = -1 flips the travel direction
 * (distance is still measured from the route start; heading is reversed).
 */
export function pointAt(route: Route, distM: number, dir: 1 | -1 = 1): RoutePoint {
  const d = Math.max(0, Math.min(route.lengthM, distM))
  const { cum, coords } = route
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! <= d) lo = mid
    else hi = mid
  }
  const a = coords[lo]!
  const b = coords[hi]!
  const segLen = cum[hi]! - cum[lo]!
  const t = segLen > 0 ? (d - cum[lo]!) / segLen : 0
  const lng = a[0] + (b[0] - a[0]) * t
  const lat = a[1] + (b[1] - a[1]) * t
  let heading = bearingDeg({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] })
  if (dir === -1) heading = (heading + 180) % 360
  return { lat, lng, heading, segment: lo }
}

/** Coordinates of the route between two distances (for drawing progress / remaining lines). */
export function sliceCoords(route: Route, fromM: number, toM: number): [number, number][] {
  const lo = Math.max(0, Math.min(fromM, toM))
  const hi = Math.min(route.lengthM, Math.max(fromM, toM))
  const start = pointAt(route, lo)
  const end = pointAt(route, hi)
  const out: [number, number][] = [[start.lng, start.lat]]
  for (let i = 0; i < route.coords.length; i++) {
    if (route.cum[i]! > lo && route.cum[i]! < hi) out.push(route.coords[i]!)
  }
  out.push([end.lng, end.lat])
  return out
}

export function routeEndpoints(route: Route, dir: 1 | -1) {
  const first = route.coords[0]!
  const last = route.coords[route.coords.length - 1]!
  const from = dir === 1 ? first : last
  const to = dir === 1 ? last : first
  return {
    fromName: dir === 1 ? route.originName : route.destName,
    toName: dir === 1 ? route.destName : route.originName,
    from: { lat: from[1], lng: from[0] },
    to: { lat: to[1], lng: to[0] },
  }
}
