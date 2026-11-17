import { useSearchParams } from 'react-router-dom'
import { Building2, Briefcase, Shapes } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menus'
import { Page, PageHeader } from '@/components/shared/Page'
import { useDb } from '@/store/db'
import { ReadOnlyNotice, useAdminCaps } from './components/AdminBits'
import { BranchesTab } from './components/BranchesTab'
import { DepartmentsTab } from './components/DepartmentsTab'
import { GeofencesTab } from './components/GeofencesTab'

const TABS = ['branches', 'departments', 'geofences'] as const

export default function OrganisationPage() {
  const [params, setParams] = useSearchParams()
  const caps = useAdminCaps()
  const counts = { branches: useDb((s) => s.branches.length), departments: useDb((s) => s.departments.length), geofences: useDb((s) => s.geofences.length) }
  const branchParam = params.get('branch')
  const requested = params.get('tab')
  const tab = (TABS as readonly string[]).includes(requested ?? '') ? requested! : 'branches'

  const setTab = (v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('tab', v)
      n.delete('branch')
      return n
    }, { replace: true })

  return (
    <Page>
      <PageHeader title="Organisation" description="The structure FleetCore reports against: branches and depots, departments and cost centres, and the geofences that drive location alerts." />
      {!caps.edit && <ReadOnlyNotice what="organisation data" />}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="branches"><Building2 /> Branches & depots <Count n={counts.branches} /></TabsTrigger>
          <TabsTrigger value="departments"><Briefcase /> Departments <Count n={counts.departments} /></TabsTrigger>
          <TabsTrigger value="geofences"><Shapes /> Geofences <Count n={counts.geofences} /></TabsTrigger>
        </TabsList>
        <TabsContent value="branches">
          <BranchesTab
            highlightId={tab === 'branches' ? branchParam : null}
            onClearHighlight={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('branch'); return n }, { replace: true })}
          />
        </TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
        <TabsContent value="geofences"><GeofencesTab /></TabsContent>
      </Tabs>
    </Page>
  )
}

function Count({ n }: { n: number }) {
  return <span className="num rounded bg-surface-3 px-1 text-[10px] text-muted-foreground">{n}</span>
}
