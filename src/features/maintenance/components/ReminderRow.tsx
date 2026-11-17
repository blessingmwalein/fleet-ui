import { Link } from 'react-router-dom'
import { AlarmClockCheck, ClipboardPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EntityLink, VehicleLink } from '@/components/shared/EntityLink'
import { cn } from '@/lib/utils'
import type { ScheduleRow } from '../lib/data'

/** One overdue / due-soon service in a reminders list. */
export function ReminderRow({ s, onCreate, onServiced, canCreate, canEdit }: { s: ScheduleRow; onCreate: () => void; onServiced: () => void; canCreate: boolean; canEdit: boolean }) {
  const overdue = s.state === 'overdue'
  return (
    <li className="flex items-center gap-3 px-3.5 py-2 text-[13px]">
      <span className={cn('size-1.5 shrink-0 rounded-full', overdue ? 'bg-danger' : 'bg-warning')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <VehicleLink id={s.vehicleId} />
          <Link to={`/maintenance/schedules?open=${s.id}`} className="truncate hover:text-primary hover:underline">{s.task}</Link>
        </div>
        <p className={cn('text-xs', overdue ? 'text-danger' : 'text-warning')}>{s.remaining}</p>
      </div>
      {s.openWoId ? (
        <EntityLink type="workorder" id={s.openWoId} className="num shrink-0 text-xs">{s.openWoNo}</EntityLink>
      ) : (
        <div className="flex shrink-0 gap-1">
          {canCreate && <Button size="xs" variant="outline" onClick={onCreate}><ClipboardPlus /> Work order</Button>}
          {canEdit && <Button size="xs" variant="ghost" onClick={onServiced} aria-label={`Mark ${s.task} serviced`}><AlarmClockCheck /></Button>}
        </div>
      )}
    </li>
  )
}
