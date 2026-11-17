import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays'
import { DetailGrid } from '@/components/shared/Page'
import { Plate } from '@/components/shared/Status'
import { DriverLink, TripLink, VehicleLink } from '@/components/shared/EntityLink'
import { useMoney } from '@/hooks/useMoney'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { VEHICLE_CATEGORY } from '@/config/status'
import { cn } from '@/lib/utils'
import { DeviationBar, FlagBadge, ReconciledBadge, RULE_ICON, Stat } from './components'
import { FlagActionButtons, type useFlagActions } from './FlagActions'
import { deleteTransactions, markReconciled, reportReconciled } from './actions'
import { explainFlag, flagOf, FUEL_RULES, type FuelRow } from './lib'
import { useFuelPerms } from './hooks'

export function TransactionDrawer({ row, allRows, onClose, onOpen, flags }: { row: FuelRow | null; allRows: FuelRow[]; onClose: () => void; onOpen: (id: string) => void; flags: ReturnType<typeof useFlagActions> }) {
  const money = useMoney()
  const { canReview, canDelete } = useFuelPerms()
  const history = useMemo(() => (row ? allRows.filter((r) => r.vehicleId === row.vehicleId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7) : []), [allRows, row])
  const ex = row ? explainFlag(row) : null
  const RuleIcon = RULE_ICON[ex?.rule ?? 'other']
  const review = row ? flagOf(row)?.review : undefined

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        {row && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <SheetTitle className="num">{row.ref}</SheetTitle>
                <ReconciledBadge reconciled={row.reconciled} />
                <FlagBadge flag={row.flag} state={row.flagState} rule={row.rule} />
              </div>
              <SheetDescription>
                {fmtDateTime(row.date)} · {row.stationName}, {row.city}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Litres" value={`${fmtNumber(row.litres, 1)} L`} hint={`${fmtNumber(row.tankFillPct)}% of ${row.tankL} L tank`} tone={row.rule === 'overfill' ? 'danger' : undefined} />
                <Stat label="Total" value={money(row.totalUsd, { digits: 2 })} hint={`${money(row.pricePerLitreUsd, { digits: 2 })} / L`} />
                <Stat label="Odometer" value={`${fmtNumber(row.odometerKm)} km`} hint={row.distanceKm ? `+${fmtNumber(row.distanceKm)} km since last fill` : 'No distance baseline'} tone={row.rule === 'odometer' ? 'danger' : undefined} />
                <Stat
                  label="Efficiency"
                  value={row.l100 !== null ? `${row.l100.toFixed(1)} L/100` : '—'}
                  hint={row.l100 !== null ? `Benchmark ${row.benchmark} L/100 km` : 'Needs ≥ 40 km since previous fill'}
                  tone={row.l100 !== null && row.l100 > row.benchmark * 1.25 ? 'danger' : row.l100 !== null && row.l100 < row.benchmark * 1.05 ? 'success' : undefined}
                />
              </div>

              {row.flag && ex && (
                <section className="rounded-lg border border-warning/30 bg-warning/5 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <RuleIcon className="size-4 text-warning" />
                      {ex.title}
                    </div>
                    <Badge tone={row.flag.severity === 'high' ? 'danger' : row.flag.severity === 'medium' ? 'warning' : 'info'}>{row.flag.severity} severity</Badge>
                  </div>
                  <p className="mt-1.5 text-[13px]">{ex.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Rule:</span> {FUEL_RULES[ex.rule].summary} <span className="font-medium text-foreground">Next step:</span> {ex.action}
                  </p>
                  {review && (
                    <p className="mt-2 rounded border border-border bg-card/60 px-2 py-1.5 text-xs text-muted-foreground">
                      {review.status === 'escalated' ? 'Escalated' : 'Under review'} by <span className="font-medium text-foreground">{review.by}</span> · {fmtDateTime(review.at)}
                      {review.note ? <> — “{review.note}”</> : null}
                      {review.incidentId && (
                        <Link to={`/safety/incidents?open=${review.incidentId}`} className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                          View incident <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </p>
                  )}
                  <div className="mt-3">
                    <FlagActionButtons row={row} flags={flags} size="sm" />
                  </div>
                </section>
              )}

              <section>
                <h3 className="label-xs mb-2">Consumption analysis</h3>
                {row.distanceKm !== null && row.expectedL !== null ? (
                  <div className="space-y-3 rounded-lg border border-border p-3.5">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="label-xs">Purchased</div>
                        <div className="num text-[15px] font-semibold">{fmtNumber(row.litres, 1)} L</div>
                      </div>
                      <div>
                        <div className="label-xs">Expected</div>
                        <div className="num text-[15px] font-semibold">{fmtNumber(row.expectedL, 1)} L</div>
                        <div className="text-[11px] text-subtle-foreground">{fmtNumber(row.distanceKm)} km × {row.benchmark} L/100</div>
                      </div>
                      <div>
                        <div className="label-xs">Variance</div>
                        <div className={cn('num text-[15px] font-semibold', (row.variancePct ?? 0) > 25 ? 'text-danger' : (row.variancePct ?? 0) > 10 ? 'text-warning' : 'text-success')}>
                          {(row.variancePct ?? 0) > 0 ? '+' : ''}
                          {fmtNumber(row.variancePct ?? 0)}%
                        </div>
                        <div className="text-[11px] text-subtle-foreground">{(row.varianceL ?? 0) > 0 ? '+' : ''}{fmtNumber(row.varianceL ?? 0, 1)} L</div>
                      </div>
                    </div>
                    <DeviationBar value={row.variancePct ?? 0} max={60} />
                    <p className="text-xs text-muted-foreground">
                      Distance is the odometer delta from the previous fill {row.prevRef && <span className="font-medium text-foreground">{row.prevRef}</span>} ({fmtDateTime(row.prevDate)}, {fmtNumber(row.prevOdometerKm)} km).
                      {!row.reliable && ' This interval is excluded from fleet efficiency statistics (implausible consumption — probably a missed fill).'}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-3.5 text-xs text-muted-foreground">
                    {row.prevRef ? 'Distance since the previous fill is under 40 km (or the odometer did not advance), so expected litres cannot be computed reliably.' : 'This is the first fill on record for this vehicle — there is no previous odometer reading to compare with.'}
                    {row.flag?.expectedLitres ? ` Detection threshold: ${fmtNumber(row.flag.expectedLitres)} L.` : ''}
                  </p>
                )}
              </section>

              <section>
                <h3 className="label-xs mb-2">Details</h3>
                <DetailGrid
                  columns={2}
                  items={[
                    { label: 'Vehicle', value: <span className="flex items-center gap-2"><VehicleLink id={row.vehicleId} />{row.category && <span className="text-xs text-subtle-foreground">{VEHICLE_CATEGORY[row.category]}</span>}</span> },
                    { label: 'Driver', value: <DriverLink id={row.driverId} avatar /> },
                    { label: 'Trip', value: row.tripId ? <TripLink id={row.tripId} /> : '—' },
                    { label: 'Branch', value: row.branchName },
                    { label: 'Station', value: <Link to={`/fuel/stations?open=${row.stationId}`} className="hover:text-primary hover:underline">{row.stationName}</Link> },
                    { label: 'Fuel card', value: row.cardNumber ? <Link to={`/fuel/cards?open=${row.cardId}`} className="num hover:text-primary hover:underline">{row.cardNumber}</Link> : 'Cash / no card' },
                    { label: 'Fuel type', value: <span className="capitalize">{row.fuelType}</span> },
                    { label: 'Fill type', value: row.fullTank ? 'Full tank' : 'Partial fill' },
                  ]}
                />
              </section>

              <section>
                <h3 className="label-xs mb-2">Receipt</h3>
                <div className="mx-auto max-w-xs rounded-md border border-dashed border-border-strong bg-surface-2/60 p-4 font-mono text-[12px] leading-relaxed">
                  <div className="text-center">
                    <div className="font-semibold uppercase">{row.stationName}</div>
                    <div className="text-muted-foreground">{row.city}, Zimbabwe</div>
                  </div>
                  <div className="my-2 border-t border-dashed border-border-strong" />
                  <div className="flex justify-between"><span>Receipt</span><span>{row.receiptNo}</span></div>
                  <div className="flex justify-between"><span>Date</span><span>{fmtDateTime(row.date)}</span></div>
                  <div className="flex justify-between"><span>Vehicle</span><Plate>{row.reg}</Plate></div>
                  <div className="flex justify-between"><span>Card</span><span>{row.cardNumber || 'CASH'}</span></div>
                  <div className="my-2 border-t border-dashed border-border-strong" />
                  <div className="flex justify-between uppercase"><span>{row.fuelType}</span><span>{fmtNumber(row.litres, 2)} L</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>@ price/L</span><span>{money(row.pricePerLitreUsd, { digits: 2 })}</span></div>
                  <div className="my-2 border-t border-dashed border-border-strong" />
                  <div className="flex justify-between text-[13px] font-semibold"><span>TOTAL</span><span>{money(row.totalUsd, { digits: 2 })}</span></div>
                </div>
              </section>

              {history.length > 1 && (
                <section>
                  <h3 className="label-xs mb-2">Recent fills · {row.reg}</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                    {history.map((h) => (
                      <li key={h.id}>
                        <button type="button" onClick={() => onOpen(h.id)} className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50', h.id === row.id && 'bg-accent/40')}>
                          <span className="flex items-center gap-2">
                            <span className="num font-medium">{h.ref}</span>
                            <span className="text-subtle-foreground">{fmtDateTime(h.date)}</span>
                            {h.flag && <Badge tone={h.flag.severity === 'high' ? 'danger' : 'warning'}>flagged</Badge>}
                          </span>
                          <span className="num text-muted-foreground">{fmtNumber(h.litres, 1)} L · {h.l100 !== null ? `${h.l100.toFixed(1)} L/100` : '—'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </SheetBody>
            <SheetFooter>
              {canDelete && (
                <Button variant="outline" className="mr-auto text-danger hover:bg-danger/10" onClick={async () => { if (await deleteTransactions([row])) onClose() }}>
                  <Trash2 /> Delete
                </Button>
              )}
              {canReview && !row.reconciled && (
                <Button
                  variant={row.flag ? 'outline' : 'default'}
                  onClick={() => {
                    const [d, s] = markReconciled([row.id])
                    reportReconciled(d, s)
                  }}
                >
                  <BadgeCheck /> Mark reconciled
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>Close</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
