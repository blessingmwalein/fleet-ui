import type { LiveState, VehicleCategory } from '@/types'
import type { MapLibreMap } from '@/components/map/maplibre'

/** Status colours — the vehicle body is tinted with its live state. */
export const STATE_HEX: Record<LiveState, string> = {
  moving: '#34d17a',
  idle: '#f2a93b',
  stopped: '#6b9bf2',
  maintenance: '#9b8afb',
  offline: '#7d8794',
}

const STATES = Object.keys(STATE_HEX) as LiveState[]
const DPR = 2
const SCALE = 0.9 // logical px per SVG unit at icon-size 1

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
function mix(hex: string, target: number, f: number) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - f) + target * f)
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}
const darker = (hex: string, f = 0.28) => mix(hex, 0, f)
const lighter = (hex: string, f = 0.3) => mix(hex, 255, f)

const K = '#0d1117' // tyres / black plastics
const GLASS = '#1b2836'
const GLASS_HI = '#7fa8c9'
const WHITE = '#f4f6f9'
const AMBER = '#f2a93b'

// ---------------------------------------------------------------------------
// Top-down vehicle drawings. All face UP (north) so MapLibre can rotate them with the heading.
// Each returns [width, height, svgInner] in SVG units.
// ---------------------------------------------------------------------------
type Art = (b: string) => [number, number, string]

const wheel = (x: number, y: number, h = 8, w = 3.6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.4" fill="${K}"/>`
const wheelsRow = (w: number, ys: number[], h = 8) => ys.map((y) => wheel(0.4, y, h) + wheel(w - 4, y, h)).join('')
const outline = `stroke="#ffffff" stroke-width="1" stroke-opacity="0.92"`

const windshield = (x: number, y: number, w: number, h: number) =>
  `<path d="M${x + 1.5} ${y + h} L${x} ${y + 1.5} Q${x + w / 2} ${y - 0.8} ${x + w} ${y + 1.5} L${x + w - 1.5} ${y + h} Z" fill="${GLASS}"/><path d="M${x + 2.6} ${y + 1.8} L${x + w - 2.6} ${y + 1.8}" stroke="${GLASS_HI}" stroke-width="0.9" stroke-linecap="round" opacity="0.8"/>`

const headlights = (w: number) => `<rect x="3.2" y="1.2" width="4" height="1.6" rx="0.8" fill="${WHITE}"/><rect x="${w - 7.2}" y="1.2" width="4" height="1.6" rx="0.8" fill="${WHITE}"/>`

const ART: Record<VehicleCategory, Art> = {
  heavy_truck: (b) => [
    30, 100,
    `${wheelsRow(30, [9, 22, 74, 85], 8)}
    <rect x="4.5" y="35" width="21" height="63" rx="2.5" fill="${lighter(b, 0.22)}" ${outline}/>
    ${[44, 52, 60, 68, 76, 84, 92].map((y) => `<line x1="5.5" x2="24.5" y1="${y}" y2="${y}" stroke="${darker(b, 0.35)}" stroke-width="0.8" opacity="0.7"/>`).join('')}
    <rect x="12" y="30" width="6" height="8" rx="1" fill="${K}"/>
    <rect x="3" y="2" width="24" height="31" rx="5.5" fill="${b}" ${outline}/>
    <rect x="5.5" y="19" width="19" height="11" rx="2" fill="${darker(b)}"/>
    ${windshield(5.5, 5, 19, 9)}${headlights(30)}
    <rect x="0.2" y="9" width="2.4" height="4" rx="1" fill="${darker(b)}"/><rect x="27.4" y="9" width="2.4" height="4" rx="1" fill="${darker(b)}"/>`,
  ],
  tanker: (b) => [
    30, 100,
    `${wheelsRow(30, [9, 22, 74, 85], 8)}
    <rect x="5" y="34" width="20" height="63" rx="10" fill="${lighter(b, 0.5)}" ${outline}/>
    <rect x="10.5" y="37" width="3.4" height="57" rx="1.7" fill="${WHITE}" opacity="0.6"/>
    <rect x="5.2" y="62" width="19.6" height="4.5" fill="${AMBER}" opacity="0.9"/>
    <rect x="13.4" y="40" width="3.2" height="52" rx="1" fill="${darker(b, 0.45)}"/>
    <rect x="12" y="30" width="6" height="8" rx="1" fill="${K}"/>
    <rect x="3" y="2" width="24" height="31" rx="5.5" fill="${b}" ${outline}/>
    <rect x="5.5" y="19" width="19" height="11" rx="2" fill="${darker(b)}"/>
    ${windshield(5.5, 5, 19, 9)}${headlights(30)}`,
  ],
  refrigerated: (b) => [
    28, 80,
    `${wheelsRow(28, [8, 20, 58, 68], 8)}
    <rect x="2.5" y="28" width="23" height="50" rx="2.5" fill="${WHITE}" ${outline}/>
    <rect x="6" y="28.6" width="16" height="7" rx="1.6" fill="${lighter(b, 0.15)}" stroke="${darker(b)}" stroke-width="0.8"/>
    <rect x="9" y="30" width="10" height="1.2" rx="0.6" fill="${darker(b)}"/>
    ${[42, 50, 58, 66, 74].map((y) => `<line x1="3.5" x2="24.5" y1="${y}" y2="${y}" stroke="#c9d1db" stroke-width="0.8"/>`).join('')}
    <rect x="3" y="2" width="22" height="25" rx="5" fill="${b}" ${outline}/>
    <rect x="5" y="16" width="18" height="9" rx="2" fill="${darker(b)}"/>
    ${windshield(5, 4.8, 18, 8.4)}${headlights(28)}`,
  ],
  light_truck: (b) => [
    26, 66,
    `${wheelsRow(26, [11, 48], 8)}
    <rect x="2.5" y="26" width="21" height="38" rx="2.5" fill="${lighter(b, 0.22)}" ${outline}/>
    ${[33, 40, 47, 54, 61].map((y) => `<line x1="3.5" x2="22.5" y1="${y}" y2="${y}" stroke="${darker(b, 0.35)}" stroke-width="0.8" opacity="0.7"/>`).join('')}
    <rect x="3" y="2" width="20" height="23" rx="4.5" fill="${b}" ${outline}/>
    ${windshield(5, 5, 16, 8.5)}<rect x="5" y="16" width="16" height="7" rx="1.6" fill="${darker(b)}"/>${headlights(26)}`,
  ],
  delivery_van: (b) => [
    24, 50,
    `${wheelsRow(24, [8, 34], 8)}
    <rect x="2.5" y="1" width="19" height="48" rx="5.5" fill="${b}" ${outline}/>
    ${windshield(4.5, 4.5, 15, 8.5)}
    <rect x="5" y="17" width="14" height="28" rx="2" fill="${lighter(b, 0.2)}"/>
    ${[22, 27, 32, 37, 42].map((y) => `<line x1="5.6" x2="18.4" y1="${y}" y2="${y}" stroke="${darker(b, 0.3)}" stroke-width="0.7" opacity="0.7"/>`).join('')}
    ${headlights(24)}`,
  ],
  pickup: (b) => [
    24, 54,
    `${wheelsRow(24, [8, 38], 8)}
    <rect x="2.5" y="1" width="19" height="52" rx="4.5" fill="${b}" ${outline}/>
    ${windshield(4.5, 4.5, 15, 8)}
    <rect x="5" y="15" width="14" height="9" rx="2" fill="${darker(b)}"/>
    <rect x="4.6" y="17" width="14.8" height="3" rx="1" fill="${GLASS}"/>
    <rect x="4.5" y="27" width="15" height="23" rx="1.5" fill="${K}" stroke="${lighter(b, 0.3)}" stroke-width="1"/>
    <line x1="4.8" x2="19.2" y1="33" y2="33" stroke="#222b36" stroke-width="0.8"/>${headlights(24)}`,
  ],
  service: (b) => [
    24, 54,
    `${wheelsRow(24, [8, 38], 8)}
    <rect x="2.5" y="1" width="19" height="52" rx="4.5" fill="${b}" ${outline}/>
    ${windshield(4.5, 4.5, 15, 8)}
    <rect x="5" y="15" width="14" height="9" rx="2" fill="${darker(b)}"/>
    <rect x="6" y="14" width="12" height="2.8" rx="1.2" fill="${AMBER}" stroke="#7a5412" stroke-width="0.5"/>
    <rect x="4.5" y="27" width="15" height="23" rx="1.5" fill="${darker(b, 0.55)}" stroke="${lighter(b, 0.3)}" stroke-width="1"/>
    <rect x="6.5" y="30" width="11" height="9" rx="1" fill="${AMBER}" opacity="0.85"/>${headlights(24)}`,
  ],
  bus: (b) => [
    26, 86,
    `${wheelsRow(26, [11, 24, 60], 9)}
    <rect x="2.8" y="1" width="20.4" height="84" rx="6.5" fill="${b}" ${outline}/>
    ${windshield(4.8, 4, 16.4, 9.5)}
    ${[19, 31, 43, 55].map((y) => `<rect x="6.5" y="${y}" width="13" height="8.5" rx="1.8" fill="${lighter(b, 0.28)}" stroke="${darker(b, 0.3)}" stroke-width="0.6"/>`).join('')}
    <rect x="7" y="69" width="12" height="11" rx="2" fill="${darker(b, 0.3)}"/>
    <line x1="13" x2="13" y1="15" y2="67" stroke="${darker(b, 0.25)}" stroke-width="0.6" opacity="0.6"/>${headlights(26)}`,
  ],
  motorcycle: (b) => [
    14, 34,
    `<rect x="5" y="0.6" width="4" height="9.5" rx="2" fill="${K}"/>
    <rect x="5" y="24" width="4" height="9.5" rx="2" fill="${K}"/>
    <rect x="6.1" y="8" width="1.8" height="19" rx="0.9" fill="${darker(b, 0.4)}"/>
    <rect x="3.2" y="21" width="7.6" height="8" rx="1.6" fill="${b}" ${outline}/>
    <rect x="4.6" y="22.6" width="4.8" height="2.4" rx="0.8" fill="${lighter(b, 0.35)}"/>
    <ellipse cx="7" cy="14" rx="3.3" ry="4.4" fill="${b}" ${outline}/>
    <rect x="0.7" y="8.4" width="12.6" height="1.8" rx="0.9" fill="${K}"/>
    <path d="M3.6 10 L5 15.5 M10.4 10 L9 15.5" stroke="${WHITE}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="7" cy="17.4" rx="5" ry="2.7" fill="${WHITE}" stroke="${darker(b)}" stroke-width="0.7"/>
    <circle cx="7" cy="17.6" r="2.7" fill="${b}" stroke="#fff" stroke-width="0.9"/>
    <rect x="5.4" y="16.3" width="3.2" height="1.1" rx="0.5" fill="${GLASS}"/>
    <rect x="5.6" y="1.2" width="2.8" height="1.2" rx="0.6" fill="${WHITE}"/>`,
  ],
}

function svgImage(w: number, h: number, inner: string): Promise<HTMLImageElement> {
  const px = (v: number) => Math.round(v * SCALE * DPR)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px(w)}" height="${px(h)}">${inner}</svg>`
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** Draws the vehicle with a soft shadow on a padded canvas (so the shadow isn't clipped). */
async function vehicleImage(cat: VehicleCategory, color: string, offline: boolean) {
  const [w, h, inner] = ART[cat](color)
  const img = await svgImage(w, h, inner)
  const pad = 8 * DPR
  const c = document.createElement('canvas')
  c.width = img.width + pad * 2
  c.height = img.height + pad * 2
  const ctx = c.getContext('2d')!
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 6 * DPR
  ctx.shadowOffsetY = 1.5 * DPR
  ctx.globalAlpha = offline ? 0.72 : 1
  ctx.drawImage(img, pad, pad)
  return ctx.getImageData(0, 0, c.width, c.height)
}

/** White chevron pointing RIGHT (line-placed symbols align the +x axis with the line direction). */
function routeArrowImage() {
  const s = 24 * DPR
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.scale(DPR, DPR)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(8, 5)
  ctx.lineTo(16, 12)
  ctx.lineTo(8, 19)
  ctx.strokeStyle = 'rgba(8,12,16,0.85)'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3.2
  ctx.stroke()
  return ctx.getImageData(0, 0, s, s)
}

/** Draw a vehicle thumbnail for use outside the map (e.g. HTML lists): returns a data URL. */
export async function vehicleThumb(cat: VehicleCategory, state: LiveState = 'moving'): Promise<string> {
  const [w, h, inner] = ART[cat](STATE_HEX[state])
  const img = await svgImage(w, h, inner)
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c.toDataURL('image/png')
}

let cache: Promise<Map<string, ImageData>> | null = null
function build() {
  cache ??= (async () => {
    const out = new Map<string, ImageData>()
    const cats = Object.keys(ART) as VehicleCategory[]
    await Promise.all(
      cats.flatMap((cat) =>
        STATES.map(async (state) => {
          out.set(`veh-${cat}-${state}`, await vehicleImage(cat, STATE_HEX[state], state === 'offline'))
        }),
      ),
    )
    out.set('route-arrow', routeArrowImage())
    return out
  })()
  return cache
}

/** Registers every vehicle marker image on the map. Safe to call after every style change. */
export async function addMarkerImages(map: MapLibreMap) {
  const images = await build()
  for (const [id, data] of images) if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: DPR })
}
