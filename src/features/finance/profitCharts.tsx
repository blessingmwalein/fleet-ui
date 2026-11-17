import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis } from 'recharts'
import type { GroupPnl } from './lib'

const axisTick = { fill: 'var(--chart-axis)', fontSize: 11 }

function Tip({ active, payload, money }: { active?: boolean; payload?: { payload: GroupPnl }[]; money: (n: number) => string }) {
  const g = payload?.[0]?.payload
  if (!active || !g) return null
  return (
    <div className="min-w-44 rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-pop">
      <div className="mb-1.5 font-medium text-foreground">{g.label}</div>
      <div className="space-y-1">
        <Row k="Revenue" v={money(g.revenue)} />
        <Row k="Cost" v={money(g.cost)} />
        <Row k="Margin" v={`${money(g.margin)}${g.marginPct === null ? '' : ` · ${g.marginPct.toFixed(1)}%`}`} strong />
        <Row k="Trips" v={String(g.trips)} />
      </div>
    </div>
  )
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-muted-foreground">{k}</span>
    <span className={`num ${strong ? 'font-semibold' : 'font-medium'} text-foreground`}>{v}</span>
  </div>
)

/** Diverging horizontal bars of margin per vehicle / customer / route (best and worst performers). */
export function MarginBars({ data, money, height, onSelect }: { data: GroupPnl[]; money: (n: number, o?: { compact?: boolean }) => string; height?: number; onSelect?: (g: GroupPnl) => void }) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No data for this period</div>
  const h = height ?? Math.max(180, data.length * 24 + 28)
  return (
    <div style={{ height: h }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => money(v, { compact: true })} />
          <YAxis type="category" dataKey="label" tick={axisTick} axisLine={false} tickLine={false} width={96} interval={0} />
          <ReferenceLine x={0} stroke="var(--border-strong)" />
          <RTooltip cursor={{ fill: 'var(--accent)', opacity: 0.4 }} content={(p) => <Tip {...(p as unknown as { active?: boolean; payload?: { payload: GroupPnl }[] })} money={money} />} />
          <Bar dataKey="margin" radius={3} maxBarSize={16} isAnimationActive animationDuration={500} onClick={(d) => onSelect?.(d as unknown as GroupPnl)} cursor={onSelect ? 'pointer' : undefined}>
            {data.map((d) => <Cell key={d.key} fill={d.margin >= 0 ? 'var(--chart-1)' : 'var(--chart-6)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Revenue (y) vs cost (x). Points above the break-even diagonal earn a margin. */
export function PnlScatter({ data, money, height = 300, onSelect }: { data: GroupPnl[]; money: (n: number, o?: { compact?: boolean }) => string; height?: number; onSelect?: (g: GroupPnl) => void }) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No data for this period</div>
  const max = Math.max(...data.map((d) => Math.max(d.revenue, d.cost)), 1) * 1.05
  const good = data.filter((d) => d.margin >= 0)
  const bad = data.filter((d) => d.margin < 0)
  const tip = (p: unknown) => <Tip {...(p as { active?: boolean; payload?: { payload: GroupPnl }[] })} money={money} />
  return (
    <div style={{ height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 6, right: 12, bottom: 4, left: -4 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis type="number" dataKey="cost" name="Cost" domain={[0, max]} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => money(v, { compact: true })} label={{ value: 'Cost', position: 'insideBottomRight', offset: -2, fill: 'var(--chart-axis)', fontSize: 11 }} />
          <YAxis type="number" dataKey="revenue" name="Revenue" domain={[0, max]} tick={axisTick} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => money(v, { compact: true })} />
          <ZAxis range={[46, 46]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="var(--border-strong)" strokeDasharray="5 4" label={{ value: 'Break-even', fill: 'var(--chart-axis)', fontSize: 10, position: 'insideTopLeft' }} />
          <RTooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }} content={tip} />
          <Scatter name="Profitable" data={good} fill="var(--chart-1)" fillOpacity={0.85} onClick={(d) => onSelect?.(d as unknown as GroupPnl)} cursor={onSelect ? 'pointer' : undefined} />
          <Scatter name="Loss-making" data={bad} fill="var(--chart-6)" fillOpacity={0.9} onClick={(d) => onSelect?.(d as unknown as GroupPnl)} cursor={onSelect ? 'pointer' : undefined} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Receivables ageing: one bar per bucket, severity coloured. */
export function AgeingBars({ data, money, height = 220 }: { data: { label: string; amount: number; count: number; color: string }[]; money: (n: number, o?: { compact?: boolean }) => string; height?: number }) {
  return (
    <div style={{ height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} tickMargin={6} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => money(v, { compact: true })} />
          <RTooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as { label: string; amount: number; count: number } | undefined
              if (!active || !d) return null
              return (
                <div className="min-w-36 rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-pop">
                  <div className="mb-1 font-medium">{d.label}</div>
                  <Row k="Outstanding" v={money(d.amount)} strong />
                  <Row k="Invoices" v={String(d.count)} />
                </div>
              )
            }}
          />
          <Bar dataKey="amount" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive animationDuration={500}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
