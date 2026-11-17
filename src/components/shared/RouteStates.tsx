import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Compass, Lock, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/form-controls'
import { useCurrentUser } from '@/hooks/useAuth'
import { Page } from './Page'
import { EmptyState } from './EmptyState'

export function PageSkeleton() {
  return (
    <Page>
      <Skeleton className="mb-1 h-6 w-48" />
      <Skeleton className="mb-5 h-4 w-80" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </Page>
  )
}

export function AccessDenied() {
  const { role } = useCurrentUser()
  return (
    <Page>
      <div className="panel">
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description={`Your role (${role?.name ?? 'unknown'}) doesn't include permission to view this area. Switch role from the user menu to preview other access levels.`}
          action={<Button asChild variant="outline" size="sm"><Link to="/dashboard">Back to dashboard</Link></Button>}
        />
      </div>
    </Page>
  )
}

export function NotFound() {
  return (
    <Page>
      <div className="panel">
        <EmptyState icon={Compass} title="Page not found" description="The page you're looking for doesn't exist or has moved." action={<Button asChild size="sm"><Link to="/dashboard">Go to dashboard</Link></Button>} />
      </div>
    </Page>
  )
}

export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unexpected error'
  return (
    <Page>
      <div className="panel">
        <EmptyState icon={TriangleAlert} title="Something went wrong" description={message} action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>} />
      </div>
    </Page>
  )
}
