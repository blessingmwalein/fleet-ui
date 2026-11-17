import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { TooltipProvider } from '@/components/ui/overlays'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  )
}
