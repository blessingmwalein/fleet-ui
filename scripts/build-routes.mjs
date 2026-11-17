// Fetches real road-following geometry from the public OSRM demo server and bakes it into
// src/data/routes.generated.ts as compact encoded polylines (precision 5).
// Run:  node scripts/build-routes.mjs
import { writeFileSync } from 'node:fs'
import simplify from '@turf/simplify'
import { lineString } from '@turf/helpers'

const P = {
  hre: [31.0492, -17.8292], msasa: [31.118, -17.8383], grani: [31.042, -17.853], south: [31.016, -17.864],
  work: [31.02, -17.848], borro: [31.09, -17.764], avon: [31.033, -17.8], chitu: [31.0756, -18.0127],
  airp: [31.0928, -17.9318], ruwa: [31.246, -17.889], west: [30.97, -17.79], hatf: [31.085, -17.86],
  byo: [28.5833, -20.15], belm: [28.553, -20.175], kelv: [28.545, -20.14], kum: [28.61, -20.16], hill: [28.63, -20.19],
  mut: [32.6709, -18.9707], sak: [32.65, -18.99], chik: [32.69, -19.0],
  gwe: [29.8167, -19.45], mkoba: [29.78, -19.48], senga: [29.835, -19.425],
  kwe: [29.8149, -18.9281], kad: [29.9167, -18.3333], msv: [30.8328, -20.0632], chi: [30.2, -17.3667],
  bbr: [30.0, -22.2167], bbrBorder: [29.985, -22.226], chivhu: [30.8892, -19.0236], mar: [31.55, -18.185], rus: [32.13, -18.53],
  gwa: [29.0003, -20.9333], msvC: [30.82, -20.09],
}

const R = [
  // intercity
  { id: 'R-HRE-BYO', name: 'Harare – Bulawayo', road: 'A5 Harare–Bulawayo Hwy', kind: 'highway', pts: [P.hre, P.kad, P.kwe, P.gwe, P.byo], tol: 0.0003 },
  { id: 'R-HRE-MUT', name: 'Harare – Mutare', road: 'A3 Harare–Mutare Hwy', kind: 'highway', pts: [P.hre, P.mar, P.rus, P.mut], tol: 0.0003 },
  { id: 'R-HRE-MSV', name: 'Harare – Masvingo', road: 'A4 Harare–Masvingo Rd', kind: 'highway', pts: [P.hre, P.chivhu, P.msv], tol: 0.0003 },
  { id: 'R-MSV-BBR', name: 'Masvingo – Beitbridge', road: 'A4 Masvingo–Beitbridge Rd', kind: 'highway', pts: [P.msv, P.bbr], tol: 0.0003 },
  { id: 'R-BYO-BBR', name: 'Bulawayo – Beitbridge', road: 'A6 Bulawayo–Beitbridge Rd', kind: 'highway', pts: [P.byo, P.gwa, P.bbr], tol: 0.0003 },
  { id: 'R-HRE-CHI', name: 'Harare – Chinhoyi', road: 'A1 Harare–Chinhoyi Rd', kind: 'highway', pts: [P.hre, P.chi], tol: 0.0002 },
  { id: 'R-GWE-MSV', name: 'Gweru – Masvingo', road: 'A9 Gweru–Masvingo Rd', kind: 'highway', pts: [P.gwe, P.msv], tol: 0.0003 },
  { id: 'R-HRE-KWE', name: 'Harare – Kwekwe', road: 'A5 Harare–Kwekwe Hwy', kind: 'highway', pts: [P.hre, P.kad, P.kwe], tol: 0.0002 },
  { id: 'R-KWE-GWE', name: 'Kwekwe – Gweru', road: 'A5 Kwekwe–Gweru Rd', kind: 'highway', pts: [P.kwe, P.gwe], tol: 0.0002 },
  { id: 'R-BYO-GWE', name: 'Bulawayo – Gweru', road: 'A5 Bulawayo–Gweru Rd', kind: 'highway', pts: [P.byo, P.gwe], tol: 0.0002 },
  // city loops
  { id: 'R-HRE-C1', name: 'Msasa – CBD – Borrowdale', road: 'Samora Machel Ave / Borrowdale Rd', kind: 'city', pts: [P.msasa, P.hre, P.borro], tol: 0.00005 },
  { id: 'R-HRE-C2', name: 'Graniteside – Southerton – Chitungwiza', road: 'Seke Rd / Simon Mazorodze Rd', kind: 'city', pts: [P.grani, P.south, P.chitu], tol: 0.00006 },
  { id: 'R-HRE-C3', name: 'Workington – Avondale – Westgate', road: 'Lytton Rd / Harare Dr', kind: 'city', pts: [P.work, P.avon, P.west], tol: 0.00005 },
  { id: 'R-HRE-C4', name: 'Ruwa – Msasa – CBD', road: 'Mutare Rd (Harare)', kind: 'city', pts: [P.ruwa, P.msasa, P.hre], tol: 0.00006 },
  { id: 'R-HRE-C5', name: 'CBD – Hatfield – Airport', road: 'Airport Rd / Chiremba Rd', kind: 'city', pts: [P.hre, P.hatf, P.airp], tol: 0.00005 },
  { id: 'R-BYO-C1', name: 'Belmont – CBD – Kumalo', road: 'Fort St / Leopold Takawira Ave', kind: 'city', pts: [P.belm, P.byo, P.kum], tol: 0.00005 },
  { id: 'R-BYO-C2', name: 'Kelvin North – CBD – Hillside', road: 'Luveve Rd / Plumtree Rd', kind: 'city', pts: [P.kelv, P.byo, P.hill], tol: 0.00005 },
  { id: 'R-MUT-C1', name: 'Sakubva – CBD – Chikanga', road: 'Herbert Chitepo St / Hobhouse', kind: 'city', pts: [P.sak, P.mut, P.chik], tol: 0.00005 },
  { id: 'R-GWE-C1', name: 'Mkoba – CBD – Senga', road: 'Lobengula Ave / Main St', kind: 'city', pts: [P.mkoba, P.gwe, P.senga], tol: 0.00005 },
  { id: 'R-BBR-C1', name: 'Beitbridge Town – Border Post', road: 'A6 Beitbridge Border Rd', kind: 'city', pts: [P.bbr, P.bbrBorder], tol: 0.00003 },
  { id: 'R-MSV-C1', name: 'Masvingo CBD – Rhodene', road: 'Robertson St / Mutirikwi Rd', kind: 'city', pts: [P.msv, P.msvC], tol: 0.00004 },
]

function encodeNum(n) {
  let v = n < 0 ? ~(n << 1) : n << 1
  let s = ''
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
  return s + String.fromCharCode(v + 63)
}
function encode(coords) {
  let out = '', pLat = 0, pLng = 0
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5)
    out += encodeNum(la - pLat) + encodeNum(ln - pLng)
    pLat = la; pLng = ln
  }
  return out
}
const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.sqrt(x))
}

const out = []
for (const r of R) {
  const coordStr = r.pts.map((p) => p.join(',')).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=false`
  let data
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url)
      data = await res.json()
      if (data.code === 'Ok') break
      console.warn(r.id, 'attempt', attempt, data.code, data.message)
    } catch (e) { console.warn(r.id, 'fetch error', e.message) }
    await new Promise((s) => setTimeout(s, 1500))
  }
  if (!data || data.code !== 'Ok') throw new Error('Failed route ' + r.id)
  const raw = data.routes[0].geometry.coordinates
  const simp = simplify(lineString(raw), { tolerance: r.tol, highQuality: false }).geometry.coordinates
  let len = 0
  for (let i = 1; i < simp.length; i++) len += hav(simp[i - 1], simp[i])
  console.log(r.id.padEnd(12), 'osrm km', (data.routes[0].distance / 1000).toFixed(1), 'pts', raw.length, '->', simp.length, 'len', len.toFixed(1))
  out.push({ id: r.id, name: r.name, road: r.road, kind: r.kind, originName: r.name.split(' – ')[0], destName: r.name.split(' – ').at(-1), poly: encode(simp), lengthKm: Math.round(len * 10) / 10 })
  await new Promise((s) => setTimeout(s, 700))
}

const body = `// AUTO-GENERATED by scripts/build-routes.mjs from OSRM road geometry. Do not edit by hand.
export interface RouteDef {
  id: string
  name: string
  road: string
  kind: 'highway' | 'city'
  originName: string
  destName: string
  /** Google encoded polyline, precision 5 (lat,lng order) */
  poly: string
  lengthKm: number
}

export const ROUTE_DEFS: RouteDef[] = ${JSON.stringify(out, null, 1)}
`
writeFileSync(new URL('../src/data/routes.generated.ts', import.meta.url), body)
console.log('wrote', out.length, 'routes,', (body.length / 1024).toFixed(0), 'KB')
