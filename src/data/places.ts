import type { LatLng } from '@/types'

export interface NamedPlace {
  name: string
  lat: number
  lng: number
  /** towns/cities rank higher than suburbs when generating "near X" text */
  kind: 'city' | 'town' | 'suburb'
}

const c = (name: string, lat: number, lng: number): NamedPlace => ({ name, lat, lng, kind: 'city' })
const t = (name: string, lat: number, lng: number): NamedPlace => ({ name, lat, lng, kind: 'town' })
const s = (name: string, lat: number, lng: number): NamedPlace => ({ name, lat, lng, kind: 'suburb' })

/** Gazetteer used for location search and "nearest place" text for simulated GPS positions. */
export const PLACES: NamedPlace[] = [
  c('Harare', -17.8292, 31.0522),
  c('Bulawayo', -20.15, 28.5833),
  c('Mutare', -18.9707, 32.6709),
  c('Gweru', -19.45, 29.8167),
  c('Kwekwe', -18.9281, 29.8149),
  c('Masvingo', -20.0632, 30.8328),
  c('Chinhoyi', -17.3667, 30.2),
  c('Beitbridge', -22.2167, 30.0),
  t('Kadoma', -18.3333, 29.9167),
  t('Chegutu', -18.13, 30.15),
  t('Norton', -17.88, 30.7),
  t('Chivhu', -19.0236, 30.8892),
  t('Mvuma', -19.28, 30.53),
  t('Shurugwi', -19.67, 30.0),
  t('Zvishavane', -20.33, 30.07),
  t('Marondera', -18.185, 31.55),
  t('Macheke', -18.14, 31.82),
  t('Headlands', -18.25, 32.04),
  t('Rusape', -18.53, 32.13),
  t('Nyazura', -18.69, 32.17),
  t('Penhalonga', -18.89, 32.67),
  t('Gwanda', -20.9333, 29.0),
  t('West Nicholson', -21.05, 29.37),
  t('Esigodini', -20.28, 28.95),
  t('Mbalabala', -20.46, 29.05),
  t('Banket', -17.38, 30.4),
  t('Karoi', -16.81, 29.69),
  t('Ruwa', -17.889, 31.246),
  t('Chitungwiza', -18.0127, 31.0756),
  t('Epworth', -17.89, 31.15),
  t('Victoria Falls', -17.9243, 25.8572),
  t('Hwange', -18.37, 26.5),
  t('Lupane', -18.93, 27.8),
  t('Bindura', -17.3, 31.33),
  t('Shamva', -17.31, 31.57),
  t('Triangle', -21.03, 31.45),
  t('Chiredzi', -21.05, 31.67),
  t('Ngundu', -20.5, 30.78),
  // Harare suburbs
  s('Msasa', -17.8383, 31.118),
  s('Graniteside', -17.853, 31.042),
  s('Southerton', -17.864, 31.016),
  s('Workington', -17.848, 31.02),
  s('Borrowdale', -17.764, 31.09),
  s('Avondale', -17.8, 31.033),
  s('Hatfield', -17.86, 31.085),
  s('Mbare', -17.865, 31.04),
  s('Belgravia', -17.81, 31.03),
  s('Eastlea', -17.825, 31.07),
  s('Mabelreign', -17.805, 30.99),
  s('Westgate', -17.79, 30.97),
  s('Highfield', -17.9, 30.99),
  s('Waterfalls', -17.89, 31.0),
  s('Harare Airport', -17.9318, 31.0928),
  s('Lochinvar', -17.9, 31.05),
  // Bulawayo suburbs
  s('Belmont', -20.175, 28.553),
  s('Kelvin North', -20.14, 28.545),
  s('Kumalo', -20.16, 28.61),
  s('Hillside', -20.19, 28.63),
  s('Burnside', -20.23, 28.62),
  s('Famona', -20.17, 28.6),
  s('Luveve', -20.12, 28.52),
  s('Donnington', -20.2, 28.64),
  s('Makokoba', -20.165, 28.57),
  // Others
  s('Sakubva', -18.99, 32.65),
  s('Chikanga', -19.0, 32.69),
  s('Mkoba', -19.48, 29.78),
  s('Senga', -19.425, 29.835),
  s('Rhodene', -20.09, 30.82),
  s('Beitbridge Border Post', -22.226, 29.985),
]

const rad = (d: number) => (d * Math.PI) / 180
const approxKm = (a: LatLng, b: LatLng) => {
  const dLat = (b.lat - a.lat) * 111.2
  const dLng = (b.lng - a.lng) * 111.2 * Math.cos(rad((a.lat + b.lat) / 2))
  return Math.hypot(dLat, dLng)
}

export function nearestPlace(p: LatLng, maxKm = 40) {
  let best: NamedPlace | null = null
  let bestD = Infinity
  for (const pl of PLACES) {
    // light bias so that a town wins over a suburb at similar distance on highways
    const d = approxKm(p, pl) * (pl.kind === 'suburb' ? 1.0 : 0.9)
    if (d < bestD) {
      bestD = d
      best = pl
    }
  }
  return best && bestD <= maxKm ? { place: best, km: bestD } : null
}

/** "Near Msasa" / "14 km NE of Kadoma" */
export function describeLocation(p: LatLng, road?: string) {
  const n = nearestPlace(p)
  if (!n) return road ?? 'Unknown location'
  const { place, km } = n
  if (km < 2.5) return road ? `${place.name} · ${road}` : `Near ${place.name}`
  const y = p.lat - place.lat
  const x = (p.lng - place.lng) * Math.cos(rad(place.lat))
  const ang = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const dir = dirs[Math.round(ang / 45) % 8]
  const base = `${Math.round(km)} km ${dir} of ${place.name}`
  return road ? `${base} · ${road}` : base
}
