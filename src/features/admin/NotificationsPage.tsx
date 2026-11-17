import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { BellRing, Mail, MessageSquareText, Moon, RotateCcw, Save, Search, Send, SlidersHorizontal, Smartphone } from 'lucide-react'
import { NumberField } from '@/components/forms/fields'
import { useZodForm } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Checkbox, Input, Label, Switch } from '@/components/ui/form-controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { EmptyState } from '@/components/shared/EmptyState'
import { KpiCard } from '@/components/shared/KpiCard'
import { Page, PageHeader, Panel } from '@/components/shared/Page'
import { SEVERITY } from '@/config/status'
import { useCurrentUser } from '@/hooks/useAuth'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { eventBus } from '@/services/events'
import { useNotifications } from '@/store/notifications'
import { NOTIFICATION_TYPE_META, useSettings, type ChannelPrefs } from '@/store/settings'
import { useUi } from '@/store/ui'
import type { NotificationType, Severity } from '@/types'
import { useAdminPrefs } from './lib/adminPrefs'
import { logAudit } from './lib/audit'
import { ReadOnlyNotice, useAdminCaps } from './components/AdminBits'

type Channel = keyof ChannelPrefs
const CHANNELS: { key: Channel; label: string; icon: typeof BellRing }[] = [
  { key: 'inApp', label: 'In-app', icon: BellRing },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'sms', label: 'SMS', icon: Smartphone },
]

const GROUPS: { label: string; description: string; types: NotificationType[] }[] = [
  { label: 'Tracking & safety', description: 'Live vehicle events', types: ['speeding', 'harsh_event', 'incident_reported', 'geofence_enter', 'geofence_exit', 'vehicle_offline', 'vehicle_online'] },
  { label: 'Trips & delivery', description: 'Dispatch lifecycle', types: ['trip_started', 'trip_delayed', 'delivery_completed'] },
  { label: 'Fleet health & compliance', description: 'Maintenance, fuel and expiries', types: ['maintenance_overdue', 'low_fuel', 'licence_expiring', 'document_expiring'] },
  { label: 'System', description: 'Platform notices', types: ['system'] },
]
const INFORMATIONAL: NotificationType[] = ['trip_started', 'geofence_enter', 'geofence_exit', 'vehicle_online', 'delivery_completed', 'system']
const DEFAULT_EMAIL: NotificationType[] = ['incident_reported', 'maintenance_overdue', 'licence_expiring', 'document_expiring', 'vehicle_offline']
const DEFAULT_SMS: NotificationType[] = ['incident_reported', 'speeding']
const META = Object.fromEntries(NOTIFICATION_TYPE_META.map((m) => [m.type, m])) as Record<string, (typeof NOTIFICATION_TYPE_META)[number]>

const thresholdSchema = z.object({
  lowFuelPct: z.number({ error: 'Enter a percentage' }).min(1, 'Minimum 1%').max(50, 'Maximum 50%'),
  docExpiryWarnDays: z.number({ error: 'Enter a number of days' }).int('Whole days only').min(1, 'Minimum 1 day').max(180, 'Maximum 180 days'),
  idleAlertMinutes: z.number({ error: 'Enter minutes' }).int('Whole minutes only').min(1, 'Minimum 1 minute').max(240, 'Maximum 240 minutes'),
  harshBrakeG: z.number({ error: 'Enter a g-force' }).min(0.1, 'Minimum 0.1 g').max(1.5, 'Maximum 1.5 g'),
  maxDriveHours: z.number({ error: 'Enter hours' }).min(1, 'Minimum 1 hour').max(16, 'Maximum 16 hours'),
})

export default function NotificationsPage() {
  const prefs = useSettings((s) => s.notificationPrefs)
  const setChannel = useSettings((s) => s.setChannel)
  const caps = useAdminCaps()
  const readOnly = !caps.edit
  const [q, setQ] = useState('')

  const get = (t: NotificationType, c: Channel) => prefs[t]?.[c] ?? (c === 'inApp')
  const setMany = (types: NotificationType[], channel: Channel, value: boolean) => types.forEach((t) => setChannel(t, channel, value))
  const state = (types: NotificationType[], c: Channel): boolean | 'indeterminate' => {
    const n = types.filter((t) => get(t, c)).length
    return n === 0 ? false : n === types.length ? true : 'indeterminate'
  }
  const allTypes = NOTIFICATION_TYPE_META.map((m) => m.type)
  const counts = { inApp: allTypes.filter((t) => get(t, 'inApp')).length, email: allTypes.filter((t) => get(t, 'email')).length, sms: allTypes.filter((t) => get(t, 'sms')).length }

  const applyPreset = (kind: 'defaults' | 'alerts' | 'all' | 'mute') => {
    for (const t of allTypes) {
      if (kind === 'defaults') {
        setChannel(t, 'inApp', true)
        setChannel(t, 'email', DEFAULT_EMAIL.includes(t))
        setChannel(t, 'sms', DEFAULT_SMS.includes(t))
      } else if (kind === 'alerts') setChannel(t, 'inApp', !INFORMATIONAL.includes(t))
      else setChannel(t, 'inApp', kind === 'all')
    }
    logAudit('update', 'settings', 'notifications', { defaults: 'Reset notification preferences to defaults', alerts: 'Set in-app notifications to alerts only (informational types muted)', all: 'Enabled in-app delivery for all notification types', mute: 'Muted in-app delivery for all notification types' }[kind])
    toast.success({ defaults: 'Preferences reset to defaults', alerts: 'Informational notifications muted', all: 'All in-app notifications enabled', mute: 'All in-app notifications muted' }[kind])
  }

  const needle = q.trim().toLowerCase()
  const groups = GROUPS.map((g) => ({ ...g, types: g.types.filter((t) => !needle || `${META[t]?.label} ${META[t]?.description}`.toLowerCase().includes(needle)) })).filter((g) => g.types.length)

  return (
    <Page>
      <PageHeader
        title="Notification preferences"
        description="Choose which operational events reach people, and through which channel. In-app switches take effect immediately across the whole workspace."
        actions={
          !readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><SlidersHorizontal /> Presets</Button></DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuLabel>Apply a preset</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => applyPreset('all')}>Everything on (in-app)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyPreset('alerts')}>Alerts only — mute informational</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyPreset('mute')}>Mute all in-app</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyPreset('defaults')}><RotateCcw /> Reset to defaults</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      {readOnly && <ReadOnlyNotice what="notification preferences" />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Notification types" value={allTypes.length} icon={BellRing} />
        <KpiCard label="In-app enabled" value={counts.inApp} unit={`/ ${allTypes.length}`} icon={BellRing} status={counts.inApp === allTypes.length ? 'success' : counts.inApp === 0 ? 'danger' : 'warning'} />
        <KpiCard label="Email enabled" value={counts.email} unit={`/ ${allTypes.length}`} icon={Mail} />
        <KpiCard label="SMS enabled" value={counts.sms} unit={`/ ${allTypes.length}`} icon={MessageSquareText} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          title="Channel matrix"
          description="Notification type × delivery channel"
          flush
          actions={
            <div className="relative w-44 sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter types…" className="h-7 pl-8 text-xs" aria-label="Filter notification types" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
                  <th className="px-3.5 py-2 text-left font-medium">Event</th>
                  {CHANNELS.map((c) => (
                    <th key={c.key} className="w-24 px-2 py-2 text-center font-medium">
                      <span className="inline-flex flex-col items-center gap-1">
                        <span className="inline-flex items-center gap-1"><c.icon className="size-3.5" />{c.label}</span>
                        <Checkbox aria-label={`Toggle ${c.label} for every type`} disabled={readOnly} checked={state(allTypes, c.key)} onCheckedChange={(v) => setMany(allTypes, c.key, v === true)} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={4}><EmptyState compact title="No notification types match" description="Try a different search." /></td></tr>
                )}
                {groups.map((g) => (
                  <Fragment key={g.label}>
                    <tr className="border-b border-border bg-surface-2/50">
                      <td className="px-3.5 py-1.5">
                        <span className="text-xs font-semibold">{g.label}</span>
                        <span className="ml-2 text-xs text-subtle-foreground">{g.description}</span>
                      </td>
                      {CHANNELS.map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-center">
                          <Checkbox aria-label={`Toggle ${c.label} for ${g.label}`} disabled={readOnly} checked={state(g.types, c.key)} onCheckedChange={(v) => setMany(g.types, c.key, v === true)} />
                        </td>
                      ))}
                    </tr>
                    {g.types.map((t) => (
                      <tr key={t} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                        <td className="px-3.5 py-2">
                          <div className="flex items-center gap-2 font-medium">
                            {META[t]?.label}
                            {!get(t, 'inApp') && <Badge tone="warning" className="px-1 py-px text-[10px]">muted in-app</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{META[t]?.description}</div>
                        </td>
                        {CHANNELS.map((c) => (
                          <td key={c.key} className="px-2 py-2 text-center">
                            <Switch aria-label={`${META[t]?.label} via ${c.label}`} disabled={readOnly} checked={get(t, c.key)} onCheckedChange={(v) => setChannel(t, c.key, v)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-3.5 py-2 text-[11px] text-subtle-foreground">Email and SMS delivery is simulated in this demo workspace. In-app switches really suppress or allow entries in the notification centre and toast alerts.</p>
        </Panel>

        <div className="space-y-4">
          <ThresholdsPanel readOnly={readOnly} />
          <QuietHoursPanel readOnly={readOnly} />
          <TestPanel />
          <RecentPanel />
        </div>
      </div>
    </Page>
  )
}

function ThresholdsPanel({ readOnly }: { readOnly: boolean }) {
  const thresholds = useSettings((s) => s.thresholds)
  const setThresholds = useSettings((s) => s.setThresholds)
  const form = useZodForm(thresholdSchema, thresholds)
  useEffect(() => form.reset(thresholds), [thresholds, form])
  const dirty = form.formState.isDirty
  const submit = form.handleSubmit((v) => {
    setThresholds(v)
    logAudit('update', 'settings', 'thresholds', `Updated alert thresholds (low fuel ${v.lowFuelPct}%, document expiry ${v.docExpiryWarnDays} days, idle ${v.idleAlertMinutes} min, harsh braking ${v.harshBrakeG} g, max drive ${v.maxDriveHours} h)`)
    toast.success('Alert thresholds saved', { description: 'The GPS simulator and expiry monitors use the new values immediately.' })
  })
  return (
    <Panel title="Alert thresholds" description="When an event becomes an alert" actions={dirty && <Badge tone="warning">Unsaved</Badge>}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
        <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <NumberField form={form} name="lowFuelPct" label="Low fuel" suffix="%" min={1} max={50} step={1} hint="Fuel level that raises a low-fuel alert" />
          <NumberField form={form} name="docExpiryWarnDays" label="Expiry warning" suffix="days" min={1} max={180} step={1} hint="Documents & licences" />
          <NumberField form={form} name="idleAlertMinutes" label="Excess idling" suffix="min" min={1} max={240} step={1} hint="Engine on, not moving" />
          <NumberField form={form} name="harshBrakeG" label="Harsh braking" suffix="g" min={0.1} max={1.5} step={0.05} hint="Deceleration that flags an event" />
          <NumberField form={form} name="maxDriveHours" label="Max driving" suffix="h" min={1} max={16} step={0.5} hint="Continuous driving before fatigue alert" />
        </fieldset>
        {!readOnly && (
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!dirty} onClick={() => form.reset(thresholds)}>Reset</Button>
            <Button type="submit" size="sm" disabled={!dirty}><Save /> Save thresholds</Button>
          </div>
        )}
      </form>
    </Panel>
  )
}

function QuietHoursPanel({ readOnly }: { readOnly: boolean }) {
  const q = useAdminPrefs((s) => s.quietHours)
  const set = useAdminPrefs((s) => s.setQuietHours)
  return (
    <Panel title="Quiet hours" description="Hold email & SMS overnight" actions={<Switch aria-label="Enable quiet hours" disabled={readOnly} checked={q.enabled} onCheckedChange={(v) => { set({ enabled: v }); logAudit('update', 'settings', 'quiet-hours', `${v ? 'Enabled' : 'Disabled'} notification quiet hours`) }} />}>
      <div className={cn('space-y-3', !q.enabled && 'opacity-60')}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="qh-from"><Moon className="size-3" /> From</Label><Input id="qh-from" type="time" value={q.from} disabled={readOnly || !q.enabled} onChange={(e) => set({ from: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qh-to">Until</Label><Input id="qh-to" type="time" value={q.to} disabled={readOnly || !q.enabled} onChange={(e) => set({ to: e.target.value })} /></div>
        </div>
        <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[13px]">
          <span>Critical alerts bypass quiet hours<span className="block text-xs text-subtle-foreground">Incidents and offline vehicles are always delivered</span></span>
          <Switch disabled={readOnly || !q.enabled} checked={q.criticalBypass} onCheckedChange={(v) => set({ criticalBypass: v })} />
        </label>
        <p className="text-xs text-muted-foreground">{q.enabled ? `Email and SMS are held between ${q.from} and ${q.to} (Africa/Harare). In-app notifications are not affected.` : 'Email and SMS are delivered around the clock.'}</p>
      </div>
    </Panel>
  )
}

const SEVERITIES: Severity[] = ['info', 'success', 'warning', 'critical']

function TestPanel() {
  const { user } = useCurrentUser()
  const prefs = useSettings((s) => s.notificationPrefs)
  const [type, setType] = useState<NotificationType>('speeding')
  const [severity, setSeverity] = useState<Severity>('warning')
  const inApp = prefs[type]?.inApp ?? true

  const send = () => {
    const before = useNotifications.getState().items[0]?.id
    eventBus.publish({
      type,
      severity,
      title: `Test: ${META[type]?.label}`,
      message: `Test notification sent by ${user.name} from Notification preferences.`,
    })
    const delivered = useNotifications.getState().items[0]?.id !== before
    if (!delivered) toast.info(`Not delivered — in-app notifications are off for “${META[type]?.label}”`, { description: 'Switch it on in the matrix to receive it.' })
    else if (severity === 'info') toast.success('Delivered to the notification centre', { description: 'Info-level events are kept out of the toast stack. Open the bell to see it.' })
  }

  return (
    <Panel title="Send a test notification" description="Publishes a real event on the live event bus">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as NotificationType)}>
              <SelectTrigger aria-label="Notification type"><SelectValue /></SelectTrigger>
              <SelectContent>{NOTIFICATION_TYPE_META.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger aria-label="Severity"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{SEVERITY[s].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge tone={inApp ? 'success' : 'warning'}>{inApp ? 'In-app delivery on' : 'In-app delivery off — will be suppressed'}</Badge>
          <Button size="sm" onClick={send}><Send /> Send test notification</Button>
        </div>
      </div>
    </Panel>
  )
}

function RecentPanel() {
  const items = useNotifications((s) => s.items)
  const setOpen = useUi((s) => s.setNotificationsOpen)
  const recent = items.slice(0, 5)
  return (
    <Panel title="Recently delivered in-app" flush actions={<Button size="xs" variant="ghost" onClick={() => setOpen(true)}>Open centre</Button>}>
      {recent.length === 0 ? (
        <EmptyState compact title="Nothing delivered yet" description="Send a test notification to see it appear here." />
      ) : (
        <ul className="divide-y divide-border/70">
          {recent.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5 px-3.5 py-2">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-danger' : n.severity === 'warning' ? 'bg-warning' : n.severity === 'success' ? 'bg-success' : 'bg-info')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{n.title}</div>
                <div className="truncate text-xs text-muted-foreground">{n.message}</div>
              </div>
              <span className="num shrink-0 text-[11px] text-subtle-foreground">{timeAgo(n.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
