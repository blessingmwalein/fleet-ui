// Headless-browser screenshot + interaction harness for verifying UI (uses the system Microsoft Edge).
//
//   node scripts/shot.mjs <route> <out.png> [width=1440] [height=900] [waitMs=2500] [theme=dark] [fullPage=0]
//   e.g. node scripts/shot.mjs vehicles .screens/vehicles.png 1440 900 3000
//        node scripts/shot.mjs "vehicles?new=1" .screens/new-vehicle.png
//        node scripts/shot.mjs dashboard .screens/dash-mobile.png 390 844 3000 dark 1
//
// The dev server must be running (npm run dev -> http://127.0.0.1:5173). Prints console errors / page errors.
// Pass routes WITHOUT a leading slash (Git Bash rewrites "/x" into a Windows path).
//
// For interactions, import { launch } from './shot.mjs' is not needed — write a small script modelled on this one:
//   const { browser, page, logs } = await open('vehicles'); await page.getByRole('button', { name: 'New vehicle' }).click() ...
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
export const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173'

export async function open(route = 'dashboard', { width = 1440, height = 900, theme = 'dark', waitMs = 2000 } = {}) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  await ctx.addInitScript((t) => {
    try {
      if (!localStorage.getItem('fleetcore.ui')) localStorage.setItem('fleetcore.ui', JSON.stringify({ state: { theme: t, sidebarCollapsed: false, rangePreset: '30d', customFrom: '', customTo: '', branchId: 'all' }, version: 0 }))
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`[console.error] ${m.text().slice(0, 400)}`) })
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 500)}`))
  await page.goto(`${BASE}/${route.replace(/^\/+/, '')}`, { waitUntil: 'load', timeout: 60000 }).catch((e) => logs.push('[goto] ' + e.message))
  await page.waitForTimeout(waitMs)
  return { browser, ctx, page, logs }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , route = 'dashboard', out = '.screens/shot.png', w = '1440', h = '900', wait = '2500', theme = 'dark', full = '0'] = process.argv
  mkdirSync(dirname(out), { recursive: true })
  const { browser, page, logs } = await open(route, { width: Number(w), height: Number(h), theme, waitMs: Number(wait) })
  await page.screenshot({ path: out, fullPage: full === '1', timeout: 90000 })
  console.log(logs.slice(0, 25).join('\n') || 'no console errors')
  await browser.close()
}
void fileURLToPath
