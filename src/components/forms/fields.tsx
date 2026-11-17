import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { cn } from '@/lib/utils'
import { Checkbox, Input, Label, Switch, Textarea } from '@/components/ui/form-controls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Combobox, type ComboOption } from '@/components/ui/command'

/** Typed zod form hook: `const form = useZodForm(schema, defaults)`. */
export function useZodForm<S extends z.ZodType<any, any>>(schema: S, defaultValues: z.input<S>) {
  return useForm<z.input<S>, unknown, z.output<S>>({ resolver: zodResolver(schema as never) as never, defaultValues: defaultValues as never, mode: 'onTouched' })
}

/** Field components accept any react-hook-form instance (typed forms are not assignable to UseFormReturn<any> due to variance). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyForm = any

export function Field({ label, error, hint, required, className, children, htmlFor }: { label?: React.ReactNode; error?: string; hint?: React.ReactNode; required?: boolean; className?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-danger">*</span>}
        </Label>
      )}
      {children}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
    </div>
  )
}

interface BaseProps {
  form: AnyForm
  name: string
  label?: React.ReactNode
  hint?: React.ReactNode
  required?: boolean
  className?: string
  disabled?: boolean
}

function useFieldError(form: AnyForm, name: string) {
  return form.getFieldState(name, form.formState).error?.message as string | undefined
}

export function TextField({ form, name, label, hint, required, className, placeholder, type = 'text', disabled, autoComplete, inputMode }: BaseProps & { placeholder?: string; type?: string; autoComplete?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={name}>
      <Input id={name} type={type} placeholder={placeholder} disabled={disabled} aria-invalid={!!error} autoComplete={autoComplete} inputMode={inputMode} {...form.register(name)} />
    </Field>
  )
}

/** Numeric input. Empty string becomes `undefined` so optional numbers validate cleanly. */
export function NumberField({ form, name, label, hint, required, className, placeholder, min, max, step, prefix, suffix, disabled }: BaseProps & { placeholder?: string; min?: number; max?: number; step?: number | string; prefix?: string; suffix?: string }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={name}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <div className="relative">
            {prefix && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
            <Input
              id={name}
              type="number"
              inputMode="decimal"
              placeholder={placeholder}
              min={min}
              max={max}
              step={step ?? 'any'}
              disabled={disabled}
              aria-invalid={!!error}
              className={cn(prefix && 'pl-6', suffix && 'pr-9')}
              value={field.value ?? ''}
              onBlur={field.onBlur}
              onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            />
            {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
          </div>
        )}
      />
    </Field>
  )
}

export function TextAreaField({ form, name, label, hint, required, className, placeholder, rows = 3, disabled }: BaseProps & { placeholder?: string; rows?: number }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={name}>
      <Textarea id={name} rows={rows} placeholder={placeholder} disabled={disabled} aria-invalid={!!error} {...form.register(name)} />
    </Field>
  )
}

const NONE = '__none__'

export function SelectField({ form, name, label, hint, required, className, options, placeholder = 'Select…', allowEmpty, emptyLabel = 'None', disabled }: BaseProps & { options: { value: string; label: string }[]; placeholder?: string; allowEmpty?: boolean; emptyLabel?: string }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select value={field.value ? String(field.value) : ''} onValueChange={(v) => field.onChange(v === NONE ? '' : v)} disabled={disabled}>
            <SelectTrigger aria-invalid={!!error} onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  )
}

/** Searchable select — use for entity pickers with many options (vehicles, drivers, customers). */
export function ComboField({ form, name, label, hint, required, className, options, placeholder, searchPlaceholder, clearable, disabled }: BaseProps & { options: ComboOption[]; placeholder?: string; searchPlaceholder?: string; clearable?: boolean }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Combobox options={options} value={field.value || null} onChange={(v) => field.onChange(v ?? '')} placeholder={placeholder} searchPlaceholder={searchPlaceholder} clearable={clearable} disabled={disabled} aria-invalid={!!error} />
        )}
      />
    </Field>
  )
}

export function DateField({ form, name, label, hint, required, className, withTime, disabled, min, max }: BaseProps & { withTime?: boolean; min?: string; max?: string }) {
  const error = useFieldError(form, name)
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={name}>
      <Input id={name} type={withTime ? 'datetime-local' : 'date'} disabled={disabled} aria-invalid={!!error} min={min} max={max} {...form.register(name)} />
    </Field>
  )
}

export function SwitchField({ form, name, label, hint, className, disabled }: BaseProps) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className={cn('flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2/40 px-3 py-2.5', className)}>
          <div className="min-w-0">
            <Label htmlFor={name} className="text-[13px] text-foreground">{label}</Label>
            {hint && <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>}
          </div>
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
        </div>
      )}
    />
  )
}

export function CheckboxField({ form, name, label, className, disabled }: BaseProps) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className={cn('flex cursor-pointer items-center gap-2 text-[13px]', className)}>
          <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(!!v)} disabled={disabled} />
          {label}
        </label>
      )}
    />
  )
}

/** Section heading inside a form. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn('space-y-3', className)}>
      <legend className="mb-1 w-full border-b border-border pb-1.5">
        <span className="text-[13px] font-semibold">{title}</span>
        {description && <span className="ml-2 text-xs font-normal text-muted-foreground">{description}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

/** Responsive 2-column grid for form fields. */
export function FormGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  return <div className={cn('grid gap-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</div>
}

// ---- date helpers for inputs ----
/** ISO → value for <input type="date"> */
export const toInputDate = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')
/** ISO → value for <input type="datetime-local"> (local time) */
export const toInputDateTime = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 6e4
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}
/** input value → ISO string */
export const fromInputDate = (v: string) => (v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toISOString() : '')
