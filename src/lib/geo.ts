import type { LatLng } from '@/types'

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function haversineM(a: LatLng, b: LatLng) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Initial bearing a -> b in degrees [0,360). */
export function bearingDeg(a: LatLng, b: LatLng) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function compass(deg_: number) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round((((deg_ % 360) + 360) % 360) / 45) % 8]!
}

/** Shortest signed angular difference b - a in (-180,180]. */
export function angleDiff(a: number, b: number) {
  return ((((b - a) % 360) + 540) % 360) - 180
}

export function lerpAngle(a: number, b: number, t: number) {
  return (a + angleDiff(a, b) * t + 360) % 360
}

/** Decodes a Google encoded polyline (precision 5) into GeoJSON-ordered [lng, lat] pairs. */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lng = 0
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += d
      else lng += d
    }
    out.push([lng / 1e5, lat / 1e5])
  }
  return out
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

export function fmtCoord(p: LatLng) {
  return `${Math.abs(p.lat).toFixed(4)}°${p.lat < 0 ? 'S' : 'N'}, ${Math.abs(p.lng).toFixed(4)}°${p.lng < 0 ? 'W' : 'E'}`
}
