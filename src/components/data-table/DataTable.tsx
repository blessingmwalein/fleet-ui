import * as React from 'react'
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type ColumnFiltersState, type FilterFn, type PaginationState, type RowSelectionState, type SortingState, type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, Filter, MoreHorizontal, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Skeleton } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/menus'
import { Badge } from '@/components/ui/display'
import { EmptyState } from '@/components/shared/EmptyState'

declare module '@tanstack/react-table' {
  interface FilterFns {
    /** Multi-select facet filter: the filter value is an array of allowed string values. */
    inArray: FilterFn<unknown>
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Header label used in the column-visibility menu & CSV export (defaults to string header). */
    label?: string
    /** Override the CSV value for this column. */
    exportValue?: (row: TData) => CsvValue
    align?: 'left' | 'right' | 'center'
    /** Hide the column below this breakpoint (responsive tables). */
    hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
    className?: string
  }
}

export interface FacetFilter {
  /** id of an accessor column — its value is compared as a string */
  columnId: string
  label: string
  options: { value: string; label: string }[]
}

export interface BulkAction<T> {
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  onClick: (rows: T[], clear: () => void) => void
}

export interface RowAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
  hidden?: boolean
  separatorBefore?: boolean
}

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, any>[]
  /** Unique id — column visibility and page size are remembered per table. */
  tableId: string
  getRowId?: (row: T) => string
  searchPlaceholder?: string
  facets?: FacetFilter[]
  /** Extra toolbar controls rendered after the filters (e.g. a date range or toggle). */
  toolbar?: React.ReactNode
  /** Right-aligned toolbar actions (e.g. primary "New" button). */
  actions?: React.ReactNode
  onRowClick?: (row: T) => void
  selectable?: boolean
  bulkActions?: BulkAction<T>[]
  /** Enables CSV export; value is the file name without extension. */
  exportName?: string
  pageSizes?: number[]
  defaultPageSize?: number
  defaultSort?: SortingState
  defaultHidden?: string[]
  initialFilters?: ColumnFiltersState
  initialSearch?: string
  emptyTitle?: string
  emptyDescription?: string
  loading?: boolean
  /** Card renderer used on phones instead of the table. */
  mobileCard?: (row: T) => React.ReactNode
  rowClassName?: (row: T) => string | undefined
  className?: string
  /** Hides the toolbar entirely (for small embedded tables). */
  bare?: boolean
}

const inArray: FilterFn<unknown> = (row, columnId, value: string[]) => !value?.length || value.includes(String(row.getValue(columnId) ?? ''))
inArray.autoRemove = (v) => !v || !v.length

const globalFilterFn: FilterFn<unknown> = (row, columnId, filterValue: string) => {
  const v = row.getValue(columnId)
  return v !== null && v !== undefined && String(v).toLowerCase().includes(filterValue.toLowerCase())
}

const storageKey = (id: string) => `fleetcore.table.${id}`
function readPrefs(id: string): { hidden?: VisibilityState; pageSize?: number } {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) ?? '{}')
  } catch {
    return {}
  }
}

const hideCls = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden' } as const

export function DataTable<T>({
  data, columns, tableId, getRowId, searchPlaceholder = 'Search…', facets, toolbar, actions, onRowClick, selectable, bulkActions, exportName,
  pageSizes = [10, 25, 50, 100], defaultPageSize = 25, defaultSort, defaultHidden, initialFilters, initialSearch = '', emptyTitle = 'No records found', emptyDescription = 'Try adjusting your search or filters.',
  loading, mobileCard, rowClassName, className, bare,
}: DataTableProps<T>) {
  const prefs = React.useMemo(() => readPrefs(tableId), [tableId])
  const [sorting, setSorting] = React.useState<SortingState>(defaultSort ?? [])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialFilters ?? [])
  const [globalFilter, setGlobalFilter] = React.useState(initialSearch)
  const [searchInput, setSearchInput] = React.useState(initialSearch)
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [visibility, setVisibility] = React.useState<VisibilityState>(() => prefs.hidden ?? Object.fromEntries((defaultHidden ?? []).map((id) => [id, false])))
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: prefs.pageSize ?? defaultPageSize })
  const isMobile = useIsMobile()

  // debounce search input
  React.useEffect(() => {
    const t = setTimeout(() => setGlobalFilter(searchInput), 180)
    return () => clearTimeout(t)
  }, [searchInput])

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey(tableId), JSON.stringify({ hidden: visibility, pageSize: pagination.pageSize }))
    } catch {
      /* ignore */
    }
  }, [tableId, visibility, pagination.pageSize])

  const allColumns = React.useMemo<ColumnDef<T, any>[]>(() => {
    if (!selectable) return columns
    const select: ColumnDef<T, any> = {
      id: '__select',
      size: 36,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on page"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        />
      ),
      cell: ({ row }) => <Checkbox aria-label="Select row" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />,
    }
    return [select, ...columns]
  }, [columns, selectable])

  const table = useReactTable<T>({
    data,
    columns: allColumns,
    getRowId: getRowId ? (r) => getRowId(r) : undefined,
    state: { sorting, columnFilters, globalFilter, rowSelection, columnVisibility: visibility, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: (u) => {
      setColumnFilters(u)
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    },
    onGlobalFilterChange: (u) => {
      setGlobalFilter(u)
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setVisibility,
    onPaginationChange: setPagination,
    enableRowSelection: !!selectable,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    defaultColumn: { minSize: 60, size: 140 },
    filterFns: { inArray: inArray as FilterFn<T> },
    globalFilterFn: globalFilterFn as FilterFn<T>,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  })

  const filteredCount = table.getFilteredRowModel().rows.length
  const selected = table.getSelectedRowModel().rows.map((r) => r.original)
  const clearSelection = () => setRowSelection({})
  const hasFilters = columnFilters.length > 0 || !!globalFilter

  // keep page index valid when data shrinks
  React.useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredCount / pagination.pageSize) - 1)
    if (pagination.pageIndex > maxPage) setPagination((p) => ({ ...p, pageIndex: maxPage }))
  }, [filteredCount, pagination.pageIndex, pagination.pageSize])

  const exportCsv = () => {
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== '__select' && c.id !== 'actions')
    const rows = selected.length ? table.getSelectedRowModel().rows : table.getPrePaginationRowModel().rows
    downloadCsv(
      `${exportName}-${new Date().toISOString().slice(0, 10)}`,
      cols.map((c) => c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)),
      rows.map((r) => cols.map((c) => c.columnDef.meta?.exportValue?.(r.original) ?? (r.getValue(c.id) as CsvValue))),
    )
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to CSV`)
  }

  const pageRows = table.getRowModel().rows
  const from = filteredCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const to = Math.min(filteredCount, (pagination.pageIndex + 1) * pagination.pageSize)

  return (
    <div className={cn('panel flex min-w-0 flex-col overflow-hidden', className)}>
      {!bare && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
          <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search table" />
            {searchInput && (
              <button type="button" onClick={() => { setSearchInput(''); setGlobalFilter('') }} className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {facets?.map((f) => (
            <FacetPopover key={f.columnId} facet={f} value={(columnFilters.find((c) => c.id === f.columnId)?.value as string[] | undefined) ?? []} onChange={(v) => table.getColumn(f.columnId)?.setFilterValue(v.length ? v : undefined)} />
          ))}
          {toolbar}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setColumnFilters([]); setSearchInput(''); setGlobalFilter('') }}>
              <X /> Reset
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Toggle columns">
                  <Columns3 /> <span className="max-sm:hidden">Columns</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 w-52 overflow-y-auto">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== 'actions').map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                    {c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {exportName && (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredCount}>
                <Download /> <span className="max-sm:hidden">Export CSV</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {selectable && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/25 bg-primary/8 px-3 py-1.5 text-[13px]">
          <span className="font-medium">{selected.length} selected</span>
          <div className="ml-2 flex flex-wrap items-center gap-1.5">
            {bulkActions?.map((a) => (
              <Button key={a.label} size="sm" variant={a.destructive ? 'destructive' : 'outline'} onClick={() => a.onClick(selected, clearSelection)}>
                {a.icon}
                {a.label}
              </Button>
            ))}
            {exportName && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download /> Export selected
              </Button>
            )}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {isMobile && mobileCard ? (
        <div className="divide-y divide-border">
          {loading ? <SkeletonRows n={5} cols={2} /> : pageRows.length === 0 ? <EmptyState title={emptyTitle} description={emptyDescription} compact /> : pageRows.map((r) => (
            <div key={r.id} className={cn('p-3', onRowClick && 'cursor-pointer active:bg-accent/40')} onClick={() => onRowClick?.(r.original)}>
              {mobileCard(r.original)}
            </div>
          ))}
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" style={{ minWidth: Math.max(table.getTotalSize(), 0), tableLayout: 'fixed' }}>
            <thead className="sticky top-0 z-10 bg-surface-2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta
                    const sorted = h.column.getIsSorted()
                    const canSort = h.column.getCanSort()
                    return (
                      <th
                        key={h.id}
                        style={{ width: h.getSize() }}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        className={cn(
                          'relative h-9 select-none px-3 text-left text-[11px] font-medium uppercase tracking-wider text-subtle-foreground',
                          meta?.align === 'right' && 'text-right', meta?.align === 'center' && 'text-center',
                          meta?.hideBelow && hideCls[meta.hideBelow], h.id === '__select' && 'px-3',
                        )}
                      >
                        {h.isPlaceholder ? null : canSort ? (
                          <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('group inline-flex max-w-full items-center gap-1 uppercase tracking-wider hover:text-foreground', meta?.align === 'right' && 'flex-row-reverse')}>
                            <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                            {sorted === 'asc' ? <ArrowUp className="size-3 text-primary" /> : sorted === 'desc' ? <ArrowDown className="size-3 text-primary" /> : <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                        {h.column.getCanResize() && (
                          <div
                            onMouseDown={h.getResizeHandler()}
                            onTouchStart={h.getResizeHandler()}
                            onClick={(e) => e.stopPropagation()}
                            className={cn('absolute right-0 top-1.5 h-6 w-1 cursor-col-resize touch-none select-none rounded bg-border-strong/0 hover:bg-primary/60', h.column.getIsResizing() && 'bg-primary')}
                          />
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                <SkeletonBody cols={table.getVisibleLeafColumns().length} />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length}>
                    <EmptyState title={emptyTitle} description={emptyDescription} compact action={hasFilters ? <Button size="sm" variant="outline" onClick={() => { setColumnFilters([]); setSearchInput(''); setGlobalFilter('') }}>Reset filters</Button> : undefined} />
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    onClick={(e) => {
                      if (!onRowClick) return
                      if ((e.target as HTMLElement).closest('a,button,[role=checkbox],[role=menuitem],input,label')) return
                      onRowClick(row.original)
                    }}
                    className={cn('group/row border-b border-border/70 transition-colors last:border-0 hover:bg-accent/40 data-[state=selected]:bg-primary/8', onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta
                      return (
                        <td key={cell.id} style={{ width: cell.column.getSize() }} className={cn('h-10 max-w-0 truncate px-3 py-1.5', meta?.align === 'right' && 'text-right num', meta?.align === 'center' && 'text-center', meta?.hideBelow && hideCls[meta.hideBelow], meta?.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select value={String(pagination.pageSize)} onValueChange={(v) => setPagination({ pageIndex: 0, pageSize: Number(v) })}>
            <SelectTrigger size="sm" className="w-[4.5rem]" aria-label="Rows per page"><SelectValue /></SelectTrigger>
            <SelectContent>{pageSizes.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <span className="num">
            {from}–{to} of {filteredCount.toLocaleString()}
            {filteredCount !== data.length && <span className="text-subtle-foreground"> (filtered from {data.length.toLocaleString()})</span>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} aria-label="First page"><ChevronsLeft /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button>
          <span className="num px-2">Page {pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()} aria-label="Last page"><ChevronsRight /></Button>
        </div>
      </div>
    </div>
  )
}

function FacetPopover({ facet, value, onChange }: { facet: FacetFilter; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(value.length && 'border-primary/50 bg-primary/8')}>
          <Filter className="size-3.5" />
          {facet.label}
          {value.length > 0 && <Badge tone="primary" className="ml-0.5 px-1">{value.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="max-h-64 overflow-y-auto">
          {facet.options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-accent">
              <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <div className="border-t border-border p-1 pt-1.5">
            <Button variant="ghost" size="xs" className="w-full" onClick={() => onChange([])}>Clear {facet.label.toLowerCase()}</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SkeletonBody({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-border/70">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="h-10 px-3"><Skeleton className="h-3.5 w-full max-w-[8rem]" /></td>
          ))}
        </tr>
      ))}
    </>
  )
}
function SkeletonRows({ n }: { n: number; cols: number }) {
  return <>{Array.from({ length: n }).map((_, i) => <div key={i} className="p-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/2" /></div>)}</>
}

/** Kebab menu for table rows. */
export function RowActions({ actions, label = 'Row actions' }: { actions: RowAction[]; label?: string }) {
  const visible = actions.filter((a) => !a.hidden)
  if (!visible.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        {visible.map((a, i) => (
          <React.Fragment key={a.label}>
            {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem destructive={a.destructive} onSelect={a.onClick}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Standard trailing "actions" column. */
export function actionsColumn<T>(build: (row: T) => RowAction[]): ColumnDef<T, unknown> {
  return {
    id: 'actions',
    header: '',
    size: 48,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    meta: { align: 'right', label: 'Actions' },
    cell: ({ row }) => <RowActions actions={build(row.original)} />,
  }
}
