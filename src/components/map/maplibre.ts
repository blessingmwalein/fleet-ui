/**
 * Single entry point for MapLibre GL. Always `import { maplibregl } from '@/components/map/maplibre'`
 * (never import 'maplibre-gl' directly) so the web worker is configured correctly under Vite.
 */
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setWorkerUrl(workerUrl)

export { maplibregl }
export type { Map as MapLibreMap, Marker, GeoJSONSource, LngLatBounds, StyleSpecification } from 'maplibre-gl'
