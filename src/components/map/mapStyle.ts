import type { StyleSpecification } from 'maplibre-gl'

/**
 * Basemaps (no API key required):
 *  - Carto Dark Matter / Positron / Voyager vector styles (street-level, road & place names)
 *  - Esri World Imagery satellite raster with transport + places label overlays
 */
export type BaseMapId = 'dark' | 'light' | 'streets' | 'satellite'

export const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
export const LABEL_FONT = ['Open Sans Regular']

const satellite: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    transport: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
    places: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'transport', type: 'raster', source: 'transport', paint: { 'raster-opacity': 0.9 } },
    { id: 'places', type: 'raster', source: 'places' },
  ],
}

export const BASE_STYLES: Record<BaseMapId, string | StyleSpecification> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  streets: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  satellite,
}

export const BASE_MAP_LABELS: Record<BaseMapId, string> = { dark: 'Dark', light: 'Light', streets: 'Streets', satellite: 'Satellite' }

/** Zimbabwe overview */
export const ZIM_CENTER: [number, number] = [30.0, -19.0]
export const ZIM_ZOOM = 5.6

/** Overlay colours (hex — MapLibre paint properties cannot use CSS variables). */
export const MAP_COLORS = {
  primary: '#34d17a',
  primaryLight: '#16a34a',
  info: '#6b9bf2',
  warning: '#f2a93b',
  danger: '#f0605d',
  muted: '#8a93a1',
  traveled: '#6b7685',
}
