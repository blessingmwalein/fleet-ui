import { Hammer } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { Page, PageHeader } from './Page'

/** Temporary placeholder while a module is under construction. Every module replaces its stubs. */
export function StubPage({ title, description }: { title: string; description?: string }) {
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <div className="panel">
        <EmptyState icon={Hammer} title={`${title} is being built`} description="This screen is part of the module currently under construction." />
      </div>
    </Page>
  )
}
