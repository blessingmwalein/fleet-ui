import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './overlays'

export const Command = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground', className)} {...props} />
)

export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-border px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input className={cn('flex h-full w-full bg-transparent text-[13px] outline-none placeholder:text-subtle-foreground disabled:opacity-50', className)} {...props} />
    </div>
  )
}

export const CommandList = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List className={cn('max-h-80 scroll-py-1 overflow-y-auto overflow-x-hidden p-1', className)} {...props} />
)
export const CommandEmpty = (props: React.ComponentProps<typeof CommandPrimitive.Empty>) => <CommandPrimitive.Empty className="py-8 text-center text-[13px] text-muted-foreground" {...props} />
export const CommandGroup = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn('overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle-foreground', className)}
    {...props}
  />
)
export const CommandSeparator = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) => <CommandPrimitive.Separator className={cn('-mx-1 h-px bg-border', className)} {...props} />
export const CommandItem = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn("relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-muted-foreground", className)}
    {...props}
  />
)
export const CommandShortcut = ({ className, ...props }: React.ComponentProps<'span'>) => <span className={cn('ml-auto text-[11px] tracking-wide text-subtle-foreground', className)} {...props} />

/* ----------------------------- Combobox (searchable select) ----------------------------- */
export interface ComboOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export function Combobox({
  options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', emptyText = 'No results', clearable, className, disabled, 'aria-invalid': invalid,
}: {
  options: ComboOption[]
  value: string | null | undefined
  onChange: (v: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  clearable?: boolean
  className?: string
  disabled?: boolean
  'aria-invalid'?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface-2/60 px-2.5 text-left text-[13px] shadow-xs outline-none transition-[color,box-shadow,border-color]',
            'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
            !selected && 'text-subtle-foreground',
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && value && (
                <CommandItem value="__clear__" onSelect={() => { onChange(null); setOpen(false) }} className="text-muted-foreground">
                  Clear selection
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ''} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto truncate pl-2 text-xs text-subtle-foreground">{o.hint}</span>}
                  <Check className={cn('size-3.5 shrink-0 text-primary', value === o.value ? 'opacity-100' : 'opacity-0', o.hint ? '' : 'ml-auto')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
