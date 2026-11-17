import { cn } from '@/lib/utils'

/** FleetCore mark: an "F" built from road lanes with a telemetry node. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M10 23V9.5h10.5M10 16h7.5" stroke="var(--primary-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="22.5" cy="22" r="2.6" fill="var(--primary-foreground)" opacity="0.9" />
    </svg>
  )
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <LogoMark className="shrink-0" />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">FleetCore</div>
          <div className="truncate text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle-foreground">Fleet ERP</div>
        </div>
      )}
    </div>
  )
}
