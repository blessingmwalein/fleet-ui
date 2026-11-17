import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWatch } from 'react-hook-form'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { z } from 'zod'
import { Activity, AlertTriangle, Building2, Coins, Database, Download, FlaskConical, Globe2, HardDrive, Pause, Play, RefreshCw, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { FormGrid, NumberField, SelectField, TextField, useZodForm } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Progress, Switch } from '@/components/ui/form-controls'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { resetDemoData } from '@/data/bootstrap'
import { formatMoney } from '@/hooks/useMoney'
import { DEFAULT_DISPLAY, KM_TO_MI, L_TO_GAL, useDisplayPrefs, type DateFormatId } from '@/lib/displayPrefs'
import { fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { eventSource } from '@/services/eventSimulator'
import { confirm } from '@/store/confirm'
import { useDb } from '@/store/db'
import { useLive } from '@/store/live'
import { useNotifications } from '@/store/notifications'
import { useSettings, type Currency } from '@/store/settings'
import { LIVE_STATE } from '@/config/status'
import type { LiveState } from '@/types'
import { useAdminPrefs } from './lib/adminPrefs'
import { logAudit } from './lib/audit'
import { ReadOnlyNotice, useAdminCaps } from './components/AdminBits'

const TABS = ['general', 'company', 'currency', 'simulation', 'data'] as const

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const caps = useAdminCaps()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab')! : 'general'
  return (
    <Page>
      <PageHeader title="Settings" description="Workspace-wide preferences: regional formats, company details, currency, the demo simulator and local data." />
      {!caps.edit && <ReadOnlyNotice what="settings" />}
      <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', v); return n }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="general"><Globe2 /> General</TabsTrigger>
          <TabsTrigger value="company"><Building2 /> Company</TabsTrigger>
          <TabsTrigger value="currency"><Coins /> Currency</TabsTrigger>
          <TabsTrigger value="simulation"><FlaskConical /> Simulation</TabsTrigger>
          <TabsTrigger value="data"><Database /> Data</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab readOnly={!caps.edit} /></TabsContent>
        <TabsContent value="company"><CompanyTab readOnly={!caps.edit} /></TabsContent>
        <TabsContent value="currency"><CurrencyTab readOnly={!caps.edit} /></TabsContent>
        <TabsContent value="simulation"><SimulationTab readOnly={!caps.edit} /></TabsContent>
        <TabsContent value="data"><DataTab canEdit={caps.edit} canExport={caps.exportCsv} /></TabsContent>
      </Tabs>
    </Page>
  )
}

function SaveBar({ dirty, onReset, readOnly, label = 'Save changes' }: { dirty: boolean; onReset: () => void; readOnly: boolean; label?: string }) {
  if (readOnly) return null
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
      {dirty && <span className="mr-auto text-xs text-warning">Unsaved changes</span>}
      <Button type="button" variant="outline" disabled={!dirty} onClick={onReset}>Discard</Button>
      <Button type="submit" disabled={!dirty}><Save /> {label}</Button>
    </div>
  )
}

/* ------------------------------------------------------------------ General */
const TIMEZONES = ['Africa/Harare', 'Africa/Johannesburg', 'Africa/Lusaka', 'Africa/Maputo', 'Africa/Gaborone', 'Africa/Windhoek', 'Africa/Lubumbashi', 'Africa/Nairobi', 'Africa/Dar_es_Salaam', 'Africa/Lagos', 'Africa/Cairo', 'UTC', 'Europe/London', 'Asia/Dubai']
const DATE_FORMATS: DateFormatId[] = ['dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']
const generalSchema = z.object({
  timezone: z.string().min(1, 'Select a timezone'),
  dateFormat: z.enum(['dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']),
  timeFormat: z.enum(['24h', '12h']),
  distanceUnit: z.enum(['km', 'mi']),
  volumeUnit: z.enum(['L', 'gal']),
})

function GeneralTab({ readOnly }: { readOnly: boolean }) {
  const timezone = useSettings((s) => s.timezone)
  const prefs = useDisplayPrefs()
  const current = useMemo(() => ({ timezone, dateFormat: prefs.dateFormat, timeFormat: prefs.timeFormat, distanceUnit: prefs.distanceUnit, volumeUnit: prefs.volumeUnit }), [timezone, prefs.dateFormat, prefs.timeFormat, prefs.distanceUnit, prefs.volumeUnit])
  const form = useZodForm(generalSchema, current)
  useEffect(() => form.reset(current), [current, form])
  const v = useWatch({ control: form.control }) as z.infer<typeof generalSchema>
  const now = new Date()
  const submit = form.handleSubmit((vals) => {
    useSettings.getState().set({ timezone: vals.timezone })
    useDisplayPrefs.getState().setPrefs({ dateFormat: vals.dateFormat, timeFormat: vals.timeFormat, distanceUnit: vals.distanceUnit, volumeUnit: vals.volumeUnit })
    logAudit('update', 'settings', 'general', `Updated regional settings (${vals.timezone}, ${vals.dateFormat}, ${vals.timeFormat} clock, ${vals.distanceUnit}/${vals.volumeUnit})`)
    toast.success('Regional settings saved', { description: 'Dates and units update across the app as you open each screen.' })
  })
  const zoneNow = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: v.timezone || timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: v.timeFormat === '12h' }).format(now)
    } catch {
      return '—'
    }
  })()
  const datePattern = v.dateFormat ?? 'dd MMM yyyy'
  const timePattern = v.timeFormat === '12h' ? 'hh:mm a' : 'HH:mm'
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel title="Regional & display" description="Applied to every date, distance and fuel volume formatted by the app">
        <fieldset disabled={readOnly} className="space-y-4">
          <FormGrid>
            <SelectField form={form} name="timezone" label="Timezone" required options={TIMEZONES.map((z) => ({ value: z, label: z.replace('_', ' ') }))} hint="Used for scheduling and report cut-offs" />
            <SelectField form={form} name="dateFormat" label="Date format" required options={DATE_FORMATS.map((f) => ({ value: f, label: `${f}  —  ${format(now, f)}` }))} />
            <SelectField form={form} name="timeFormat" label="Clock" required options={[{ value: '24h', label: '24-hour (14:30)' }, { value: '12h', label: '12-hour (2:30 PM)' }]} />
            <div />
            <SelectField form={form} name="distanceUnit" label="Distance" required options={[{ value: 'km', label: 'Kilometres (km)' }, { value: 'mi', label: 'Miles (mi)' }]} hint="Display only — odometers are stored in km" />
            <SelectField form={form} name="volumeUnit" label="Fuel volume" required options={[{ value: 'L', label: 'Litres (L)' }, { value: 'gal', label: 'US gallons (gal)' }]} hint="Display only — fuel is stored in litres" />
          </FormGrid>
          <SaveBar dirty={form.formState.isDirty} onReset={() => form.reset(current)} readOnly={readOnly} />
          {!readOnly && (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => form.reset({ timezone: 'Africa/Harare', ...DEFAULT_DISPLAY }, { keepDefaultValues: true })}>
              Restore regional defaults
            </button>
          )}
        </fieldset>
      </Panel>
      <Panel title="Live preview" description="How values will read">
        <dl className="space-y-3 text-[13px]">
          <PreviewRow label="Now in your timezone" value={zoneNow} />
          <PreviewRow label="Date" value={format(now, datePattern)} />
          <PreviewRow label="Date & time" value={`${format(now, datePattern)}, ${format(now, timePattern)}`} />
          <PreviewRow label="Trip distance" value={v.distanceUnit === 'mi' ? `${fmtNumber(1248 * KM_TO_MI)} mi` : '1,248 km'} />
          <PreviewRow label="Tank fill" value={v.volumeUnit === 'gal' ? `${fmtNumber(412 * L_TO_GAL)} gal` : '412 L'} />
        </dl>
      </Panel>
    </form>
  )
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-right font-medium">{value}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ Company */
const companySchema = z.object({
  name: z.string().trim().min(2, 'Enter the trading name'),
  legalName: z.string().trim().min(2, 'Enter the registered legal name'),
  registrationNo: z.string().trim().min(3, 'Enter the company registration number'),
  taxNo: z.string().trim().min(3, 'Enter the tax (BP) number'),
  address: z.string().trim().min(3, 'Enter the street address'),
  city: z.string().trim().min(2, 'Enter the city'),
  country: z.string().trim().min(2, 'Enter the country'),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
  email: z.string().trim().email('Enter a valid email address'),
  website: z.string().trim().regex(/^$|^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i, 'Enter a valid website, e.g. www.example.co.zw'),
})

function CompanyTab({ readOnly }: { readOnly: boolean }) {
  const company = useSettings((s) => s.company)
  const form = useZodForm(companySchema, company)
  useEffect(() => form.reset(company), [company, form])
  const v = useWatch({ control: form.control }) as z.infer<typeof companySchema>
  const submit = form.handleSubmit((vals) => {
    useSettings.getState().setCompany(vals)
    logAudit('update', 'settings', 'company', `Updated company information for ${vals.name}`)
    toast.success('Company information saved')
  })
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title="Company information" description="Shown on invoices, reports and exported documents">
        <fieldset disabled={readOnly} className="space-y-4">
          <FormGrid>
            <TextField form={form} name="name" label="Trading name" required />
            <TextField form={form} name="legalName" label="Legal name" required />
            <TextField form={form} name="registrationNo" label="Registration number" required />
            <TextField form={form} name="taxNo" label="Tax / BP number" required />
            <TextField form={form} name="address" label="Street address" required className="sm:col-span-2" />
            <TextField form={form} name="city" label="City" required />
            <TextField form={form} name="country" label="Country" required />
            <TextField form={form} name="phone" label="Phone" required inputMode="tel" />
            <TextField form={form} name="email" label="Email" required type="email" />
            <TextField form={form} name="website" label="Website" className="sm:col-span-2" />
          </FormGrid>
          <SaveBar dirty={form.formState.isDirty} onReset={() => form.reset(company)} readOnly={readOnly} />
        </fieldset>
      </Panel>
      <Panel title="Document header preview" description="How it appears on invoices & reports" className="self-start">
        <div className="rounded-lg border border-border bg-white p-4 text-[#12161c] shadow-xs">
          <div className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold tracking-tight">{v.name || '—'}</div>
              <div className="truncate text-[11px] text-neutral-500">{v.legalName}</div>
            </div>
            <div className="shrink-0 text-right text-[10px] uppercase tracking-wider text-neutral-400">Tax invoice</div>
          </div>
          <div className="mt-3 space-y-0.5 text-[11px] leading-relaxed text-neutral-600">
            <div>{v.address}</div>
            <div>{[v.city, v.country].filter(Boolean).join(', ')}</div>
            <div>{[v.phone, v.email].filter(Boolean).join('  ·  ')}</div>
            <div>{v.website}</div>
            <div className="pt-1 text-neutral-400">Reg. {v.registrationNo}  ·  BP {v.taxNo}</div>
          </div>
        </div>
      </Panel>
    </form>
  )
}

/* ------------------------------------------------------------------ Currency */
const rateSchema = z.object({ zwgRate: z.number({ error: 'Enter the exchange rate' }).positive('Rate must be greater than zero').max(1_000_000, 'Rate is unrealistically high') })
const SAMPLE_USD = [1, 25, 480, 1250, 48500, 1_250_000]

function CurrencyTab({ readOnly }: { readOnly: boolean }) {
  const currency = useSettings((s) => s.currency)
  const rate = useSettings((s) => s.zwgRate)
  const invoices = useDb((s) => s.invoices)
  const fuel = useDb((s) => s.fuelTransactions)
  const form = useZodForm(rateSchema, { zwgRate: rate })
  useEffect(() => form.reset({ zwgRate: rate }), [rate, form])
  const draft = (useWatch({ control: form.control, name: 'zwgRate' }) as number | undefined) ?? rate
  const effRate = draft > 0 ? draft : rate
  const receivables = useMemo(() => invoices.filter((i) => i.kind === 'customer' && i.status !== 'paid' && i.status !== 'draft').reduce((s, i) => s + (i.amountUsd - i.paidUsd), 0), [invoices])
  const fuel30 = useMemo(() => fuel.filter((f) => Date.now() - new Date(f.date).getTime() < 30 * 864e5).reduce((s, f) => s + f.totalUsd, 0), [fuel])

  const setCurrency = (c: Currency) => {
    if (c === currency) return
    useSettings.getState().set({ currency: c })
    logAudit('update', 'settings', 'currency', `Changed display currency to ${c === 'ZWG' ? 'ZiG' : 'USD'}`)
    toast.success(`Money now shown in ${c === 'ZWG' ? 'ZiG (Zimbabwe Gold)' : 'US dollars'}`, { description: 'Every amount in the app re-formats immediately.' })
  }
  const submit = form.handleSubmit((vals) => {
    useSettings.getState().set({ zwgRate: vals.zwgRate })
    logAudit('update', 'settings', 'currency', `Updated ZiG exchange rate to ${vals.zwgRate} per USD`)
    toast.success(`Exchange rate set to ZiG ${vals.zwgRate} per US$1`)
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Panel title="Display currency" description="All amounts are stored in USD and converted for display">
          <fieldset disabled={readOnly} className="space-y-3">
            <Segmented<Currency> size="md" aria-label="Display currency" value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'US dollar (USD)' }, { value: 'ZWG', label: 'Zimbabwe Gold (ZiG)' }]} />
            <p className="text-xs text-muted-foreground">Switching applies instantly to dashboards, tables, forms and exports across every module. Stored values never change.</p>
          </fieldset>
        </Panel>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <Panel title="Exchange rate" description="ZiG per US$1 — used whenever ZiG is the display currency">
            <fieldset disabled={readOnly} className="space-y-4">
              <NumberField form={form} name="zwgRate" label="ZiG per US$1" prefix="ZiG" step={0.01} min={0.01} required hint="Enter the rate you want to apply, e.g. the RBZ interbank mid-rate" className="max-w-xs" />
              <SaveBar dirty={form.formState.isDirty} onReset={() => form.reset({ zwgRate: rate })} readOnly={readOnly} label="Apply rate" />
            </fieldset>
          </Panel>
        </form>
      </div>
      <Panel title="Live preview" description={`Using ${draft !== rate ? 'the unsaved rate' : 'the saved rate'} of ZiG ${effRate} per US$1`} flush>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
              <th className="px-3.5 py-2 text-left font-medium">Example</th>
              <th className="px-3.5 py-2 text-right font-medium">USD</th>
              <th className="px-3.5 py-2 text-right font-medium">ZiG</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_USD.map((n) => (
              <tr key={n} className="border-b border-border/60 last:border-0">
                <td className="px-3.5 py-1.5 text-muted-foreground">{n >= 1_000_000 ? 'Annual budget' : n >= 10000 ? 'Truck purchase deposit' : n >= 1000 ? 'Monthly fuel spend' : n >= 100 ? 'Service invoice' : n >= 20 ? 'Toll & allowances' : 'Per unit'}</td>
                <td className="num px-3.5 py-1.5 text-right">{formatMoney(n, 'USD', effRate)}</td>
                <td className="num px-3.5 py-1.5 text-right">{formatMoney(n, 'ZWG', effRate)}</td>
              </tr>
            ))}
            <tr className="border-b border-border/60 bg-surface-2/40">
              <td className="px-3.5 py-1.5 text-muted-foreground">Outstanding receivables</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(receivables, 'USD', effRate, { digits: 2 })}</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(receivables, 'ZWG', effRate, { digits: 2 })}</td>
            </tr>
            <tr className="border-b border-border/60 bg-surface-2/40">
              <td className="px-3.5 py-1.5 text-muted-foreground">Fuel spend, last 30 days</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(fuel30, 'USD', effRate)}</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(fuel30, 'ZWG', effRate)}</td>
            </tr>
            <tr>
              <td className="px-3.5 py-1.5 text-muted-foreground">Compact (KPI cards)</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(1_250_000, 'USD', effRate, { compact: true })}</td>
              <td className="num px-3.5 py-1.5 text-right">{formatMoney(1_250_000, 'ZWG', effRate, { compact: true })}</td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-border px-3.5 py-2 text-[11px] text-subtle-foreground">Currently displayed in the app: <span className="font-medium text-foreground">{currency === 'ZWG' ? 'ZiG' : 'USD'}</span></p>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ Simulation */
const INTERVALS = [1000, 2000, 5000, 10000]
const SCALES = [1, 6, 12, 30, 60]

function RangeSlider({ value, min, max, step = 1, onChange, disabled, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  return (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
    />
  )
}

function SimulationTab({ readOnly }: { readOnly: boolean }) {
  const sim = useSettings((s) => s.simulation)
  const setSim = useSettings((s) => s.setSimulation)
  const telemetry = useLive((s) => s.telemetry)
  const running = useLive((s) => s.running)
  const ticks = useLive((s) => s.tick)
  const lastTickAt = useLive((s) => s.lastTickAt)
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const change = (patch: Partial<typeof sim>, what: string) => {
    setSim(patch)
    logAudit('update', 'settings', 'simulation', `Simulation: ${what}`)
  }
  const states = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of Object.values(telemetry)) c[t.state] = (c[t.state] ?? 0) + 1
    return c
  }, [telemetry])
  const vehicleCount = Object.keys(telemetry).length
  const kmPerFix = ((80 / 3.6) * (sim.intervalMs / 1000) * sim.timeScale) / 1000
  const tripMinutes = Math.round((4 * 60) / sim.timeScale)
  const secondsSince = lastTickAt ? Math.round((Date.now() - lastTickAt) / 1000) : null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div role="note" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/8 px-3.5 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-muted-foreground"><span className="font-medium text-warning">All live telemetry is demo data.</span> Vehicle positions, speeds, fuel levels and alerts are generated by an in-browser GPS simulator driving real road geometry. Connect a telematics gateway in <code className="rounded bg-surface-3 px-1 py-px font-mono text-xs">services/realtime.ts</code> to replace it.</p>
        </div>

        <Panel title="Simulator controls" description="Changes apply to the running simulator immediately">
          <fieldset disabled={readOnly} className="space-y-5">
            <ControlRow title="GPS simulator" hint="Pause to freeze all vehicles in place">
              <div className="flex items-center gap-3">
                <Badge tone={sim.enabled && running ? 'success' : 'neutral'}>{sim.enabled && running ? 'Running' : 'Paused'}</Badge>
                <Switch aria-label="Enable GPS simulator" checked={sim.enabled} onCheckedChange={(v) => change({ enabled: v }, v ? 'resumed' : 'paused')} />
              </div>
            </ControlRow>
            <ControlRow title="GPS fix interval" hint="Time between simulated position reports">
              <Segmented<string> aria-label="GPS interval" size="md" value={String(sim.intervalMs)} onChange={(v) => change({ intervalMs: Number(v) }, `GPS interval set to ${Number(v) / 1000}s`)} options={INTERVALS.map((i) => ({ value: String(i), label: `${i / 1000}s` }))} />
            </ControlRow>
            <ControlRow title={`Time scale — ${sim.timeScale}×`} hint="Speeds up vehicle movement for demos (1× = real time)">
              <div className="w-full max-w-xs space-y-2">
                <RangeSlider label="Time scale" value={sim.timeScale} min={1} max={60} onChange={(v) => setSim({ timeScale: v })} />
                <div className="flex flex-wrap gap-1">
                  {SCALES.map((s) => (
                    <Button key={s} type="button" size="xs" variant={sim.timeScale === s ? 'soft' : 'ghost'} onClick={() => change({ timeScale: s }, `time scale ${s}×`)}>{s}×</Button>
                  ))}
                </div>
              </div>
            </ControlRow>
            <ControlRow title="Operational events" hint="Alerts, incidents, geofence crossings, delays and harsh events">
              <Switch aria-label="Enable simulated events" checked={sim.events} onCheckedChange={(v) => change({ events: v }, v ? 'events on' : 'events off')} />
            </ControlRow>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button type="button" size="sm" variant="outline" onClick={() => change({ enabled: !sim.enabled }, sim.enabled ? 'paused' : 'resumed')}>
                {sim.enabled ? <Pause /> : <Play />} {sim.enabled ? 'Pause simulator' : 'Resume simulator'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { eventSource.raiseIncident(); toast.info('Demo incident raised on a moving vehicle', { description: 'Check Safety → Incidents and the notification centre.' }) }}>
                <FlaskConical /> Raise demo incident
              </Button>
              <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => { setSim({ enabled: true, intervalMs: 2000, timeScale: 12, events: true }); logAudit('update', 'settings', 'simulation', 'Simulation settings reset to defaults'); toast.success('Simulation defaults restored') }}>
                <RotateCcw /> Defaults
              </Button>
            </div>
          </fieldset>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Live status" actions={<Badge tone={sim.enabled && running ? 'success' : 'neutral'} className="gap-1"><Activity /> {sim.enabled && running ? 'Live' : 'Idle'}</Badge>}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Vehicles reporting" value={vehicleCount} />
            <Stat label="Fixes produced" value={fmtNumber(ticks)} />
            <Stat label="Last fix" value={secondsSince === null ? '—' : secondsSince <= 1 ? 'now' : `${secondsSince}s ago`} />
          </div>
          <ul className="mt-4 space-y-1.5">
            {(Object.keys(LIVE_STATE) as LiveState[]).map((s) => {
              const n = states[s] ?? 0
              return (
                <li key={s} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground">{LIVE_STATE[s].label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${vehicleCount ? (n / vehicleCount) * 100 : 0}%`, background: LIVE_STATE[s].color }} /></div>
                  <span className="num w-6 text-right font-medium">{n}</span>
                </li>
              )
            })}
          </ul>
        </Panel>
        <Panel title="What these settings mean" description="Derived from the current values">
          <ul className="space-y-2 text-[13px]">
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">A truck at 80 km/h advances</span><span className="num font-medium">{kmPerFix.toFixed(2)} km per fix</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">A 4-hour trip completes in about</span><span className="num font-medium">{tripMinutes >= 60 ? `${Math.floor(tripMinutes / 60)}h ${tripMinutes % 60}m` : `${tripMinutes} min`}</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Position reports per minute</span><span className="num font-medium">{Math.round(60000 / sim.intervalMs)} per vehicle</span></li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function ControlRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label-xs truncate">{label}</div>
      <div className="num text-lg font-semibold leading-tight">{value}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ Data */
const KEY_INFO: [RegExp, string][] = [
  [/^fleetcore\.db\./, 'Local changes to the dataset (overlay on the seeded demo data)'],
  [/^fleetcore\.sim\./, 'GPS simulator snapshot (vehicle progress)'],
  [/^fleetcore\.notifications\./, 'Notification centre history'],
  [/^fleetcore\.settings\.display/, 'Date, time and unit preferences'],
  [/^fleetcore\.settings\.admin/, 'Quiet hours'],
  [/^fleetcore\.settings$/, 'Currency, company, thresholds, notification channels, simulation'],
  [/^fleetcore\.ui/, 'Theme, sidebar, global filters'],
  [/^fleetcore\.session/, 'Signed-in demo user'],
  [/^fleetcore\.table\./, 'Table column & page-size preferences'],
]
const QUOTA = 5 * 1024 * 1024

interface StorageRow { key: string; bytes: number; info: string }
function readStorage(): StorageRow[] {
  const out: StorageRow[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('fleetcore')) continue
      const v = localStorage.getItem(key) ?? ''
      out.push({ key, bytes: (key.length + v.length) * 2, info: KEY_INFO.find(([r]) => r.test(key))?.[1] ?? 'FleetCore data' })
    }
  } catch {
    /* storage unavailable */
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`)

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const importSchema = z.object({
  app: z.literal('fleetcore'),
  settings: z.object({
    currency: z.enum(['USD', 'ZWG']).optional(),
    zwgRate: z.number().positive().optional(),
    timezone: z.string().optional(),
    company: z.record(z.string(), z.string()).optional(),
    thresholds: z.record(z.string(), z.number()).optional(),
    notificationPrefs: z.record(z.string(), z.object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean() })).optional(),
    simulation: z.object({ enabled: z.boolean(), intervalMs: z.number(), timeScale: z.number(), events: z.boolean() }).partial().optional(),
  }),
  display: z.record(z.string(), z.string()).optional(),
  quietHours: z.object({ enabled: z.boolean(), from: z.string(), to: z.string(), criticalBypass: z.boolean() }).partial().optional(),
})

function DataTab({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }) {
  const [rows, setRows] = useState<StorageRow[]>(readStorage)
  const fileRef = useRef<HTMLInputElement>(null)
  const seededAt = useDb((s) => s.seededAt)
  const db = useDb()
  const refresh = () => setRows(readStorage())
  useEffect(() => {
    const t = setTimeout(refresh, 800) // db overlay is written with a short debounce
    return () => clearTimeout(t)
  }, [db.auditLog.length])

  const total = rows.reduce((s, r) => s + r.bytes, 0)
  const collections = (Object.keys(db) as (keyof typeof db)[]).filter((k) => Array.isArray(db[k])) as (keyof typeof db)[]

  const exportSettings = () => {
    const s = useSettings.getState()
    downloadJson(`fleetcore-settings-${new Date().toISOString().slice(0, 10)}.json`, {
      app: 'fleetcore',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { currency: s.currency, zwgRate: s.zwgRate, timezone: s.timezone, company: s.company, thresholds: s.thresholds, notificationPrefs: s.notificationPrefs, simulation: s.simulation },
      display: (({ dateFormat, timeFormat, distanceUnit, volumeUnit }) => ({ dateFormat, timeFormat, distanceUnit, volumeUnit }))(useDisplayPrefs.getState()),
      quietHours: useAdminPrefs.getState().quietHours,
    })
    logAudit('export', 'settings', 'all', 'Exported workspace settings (JSON)')
    toast.success('Settings exported')
  }

  const exportDataset = () => {
    const state = useDb.getState()
    const data: Record<string, unknown> = { app: 'fleetcore', exportedAt: new Date().toISOString(), seededAt: state.seededAt }
    for (const k of collections) data[k as string] = state[k as keyof typeof state]
    downloadJson(`fleetcore-dataset-${new Date().toISOString().slice(0, 10)}.json`, data)
    logAudit('export', 'dataset', 'all', `Exported full dataset (${collections.length} collections, JSON)`)
    toast.success('Dataset exported', { description: `${collections.length} collections` })
  }

  const importSettings = async (file: File) => {
    try {
      const parsed = importSchema.parse(JSON.parse(await file.text()))
      const s = useSettings.getState()
      const { settings } = parsed
      if (settings.currency || settings.zwgRate || settings.timezone) s.set({ ...(settings.currency && { currency: settings.currency }), ...(settings.zwgRate && { zwgRate: settings.zwgRate }), ...(settings.timezone && { timezone: settings.timezone }) })
      if (settings.company) s.setCompany(settings.company)
      if (settings.thresholds) s.setThresholds(settings.thresholds)
      if (settings.simulation) s.setSimulation(settings.simulation)
      if (settings.notificationPrefs) useSettings.setState((st) => ({ notificationPrefs: { ...st.notificationPrefs, ...settings.notificationPrefs } }))
      if (parsed.display) useDisplayPrefs.getState().setPrefs(parsed.display as never)
      if (parsed.quietHours) useAdminPrefs.getState().setQuietHours(parsed.quietHours)
      logAudit('update', 'settings', 'import', `Imported workspace settings from ${file.name}`)
      toast.success('Settings imported', { description: file.name })
      refresh()
    } catch (e) {
      toast.error('Could not import settings', { description: e instanceof z.ZodError ? 'This file is not a FleetCore settings export.' : 'The file is not valid JSON.' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const clearTables = () => {
    let n = 0
    try {
      for (const r of readStorage()) if (r.key.startsWith('fleetcore.table.')) { localStorage.removeItem(r.key); n++ }
    } catch { /* ignore */ }
    toast.success(`Cleared ${n} table preference${n === 1 ? '' : 's'}`, { description: 'Column visibility and page sizes return to defaults.' })
    refresh()
  }
  const clearNotifications = async () => {
    if (!(await confirm({ title: 'Clear notification history?', description: 'All notifications are removed from the notification centre.', confirmLabel: 'Clear history', destructive: true }))) return
    useNotifications.getState().clear()
    toast.success('Notification history cleared')
    setTimeout(refresh, 800)
  }
  const reset = async () => {
    const ok = await confirm({
      title: 'Reset demo data?',
      description: 'Every change you made — records, audit entries, notifications and the simulator state — is discarded and the dataset is regenerated from scratch. Your settings (currency, company, display) are kept.',
      confirmLabel: 'Reset demo data',
      destructive: true,
    })
    if (ok) resetDemoData()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Local storage" description="Everything FleetCore keeps in this browser" actions={<Button size="icon-sm" variant="ghost" aria-label="Refresh storage usage" onClick={refresh}><RefreshCw /></Button>} flush>
        <div className="space-y-2 border-b border-border px-3.5 py-3">
          <div className="flex items-baseline justify-between text-[13px]"><span className="font-medium">{kb(total)} used</span><span className="text-xs text-muted-foreground">of ~5 MB browser quota</span></div>
          <Progress value={(total / QUOTA) * 100} indicatorClassName={total / QUOTA > 0.8 ? 'bg-danger' : total / QUOTA > 0.5 ? 'bg-warning' : undefined} />
        </div>
        <ul className="max-h-64 divide-y divide-border/70 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-3.5 py-1.5">
              <div className="min-w-0"><div className="truncate font-mono text-xs">{r.key}</div><div className="truncate text-[11px] text-subtle-foreground">{r.info}</div></div>
              <span className="num shrink-0 text-xs text-muted-foreground">{kb(r.bytes)}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="px-3.5 py-6 text-center text-xs text-muted-foreground">Nothing stored yet.</li>}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-border p-3">
            <Button size="sm" variant="outline" onClick={clearTables}><Trash2 /> Clear table preferences</Button>
            <Button size="sm" variant="outline" onClick={clearNotifications}><Trash2 /> Clear notification history</Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="Backup & restore" description="Move your configuration between browsers or environments">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={exportSettings} disabled={!canExport}><Download /> Export settings (JSON)</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!canEdit}><Upload /> Import settings…</Button>
            <Button variant="outline" onClick={exportDataset} disabled={!canExport} className="sm:col-span-2"><HardDrive /> Download full dataset (JSON)</Button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import settings file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSettings(f) }} />
          <p className="mt-2 text-xs text-muted-foreground">Settings exports include currency, company details, thresholds, notification channels, simulation and display preferences.</p>
        </Panel>

        <Panel title="Dataset" description={`Demo data seeded ${fmtDateTime(seededAt)} (${timeAgo(seededAt)})`} flush>
          <ul className="grid max-h-56 grid-cols-2 gap-x-4 overflow-y-auto px-3.5 py-2 text-xs">
            {collections.map((k) => (
              <li key={String(k)} className="flex items-center justify-between gap-2 border-b border-border/50 py-1">
                <span className="truncate text-muted-foreground">{String(k).replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                <span className="num font-medium">{fmtNumber((db[k] as unknown[]).length)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className={cn('rounded-lg border border-danger/30 bg-danger/5 p-4')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-danger">Reset demo data</div>
              <p className="mt-0.5 max-w-md text-xs text-muted-foreground">Discards every local change and regenerates the dataset. Settings are kept.</p>
            </div>
            <Button variant="destructive" onClick={reset} disabled={!canEdit}><RotateCcw /> Reset demo data</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
