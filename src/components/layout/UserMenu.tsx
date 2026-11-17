import { LogOut, RotateCcw, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/menus'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDb } from '@/store/db'
import { useSession } from '@/store/session'
import { confirm } from '@/store/confirm'
import { resetDemoData } from '@/data/bootstrap'
import { navigateTo } from '@/lib/navigation'

/** Shared menu body for the sidebar profile and the top bar user button. */
export function UserMenuItems() {
  const { user, role } = useCurrentUser()
  const users = useDb((s) => s.users)
  const roles = useDb((s) => s.roles)
  const switchUser = useSession((s) => s.switchUser)

  return (
    <>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar name={user.name} size={34} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          <div className="mt-0.5 text-[11px] text-primary">{role?.name}</div>
        </div>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigateTo('/admin/settings')}>
        <UserCog /> Account & settings
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <UserCog /> Switch role (demo)
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
          <DropdownMenuLabel>Preview the app as…</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={user.id}
            onValueChange={(id) => {
              switchUser(id)
              const u = users.find((x) => x.id === id)
              toast.success(`Now viewing as ${u?.name}`, { description: roles.find((r) => r.id === u?.roleId)?.name })
            }}
          >
            {users.filter((u) => u.status === 'active').map((u) => (
              <DropdownMenuRadioItem key={u.id} value={u.id}>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate">{u.name}</span>
                  <span className="truncate text-[11px] text-subtle-foreground">{roles.find((r) => r.id === u.roleId)?.name}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        onSelect={async () => {
          if (await confirm({ title: 'Reset demo data?', description: 'All changes you made will be discarded and the dataset regenerated from scratch.', confirmLabel: 'Reset', destructive: true })) resetDemoData()
        }}
      >
        <RotateCcw /> Reset demo data
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toast.info('This is a demo workspace — sign-out is disabled.')}>
        <LogOut /> Sign out
      </DropdownMenuItem>
    </>
  )
}

export function UserMenuButton() {
  const { user } = useCurrentUser()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="User menu">
          <Avatar name={user.name} size={28} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <UserMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
