'use client'

import { useRouter } from 'next/navigation'
import { Download, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DashboardHeaderActionsProps {
  exportHref?: string
}

export function DashboardHeaderActions({ exportHref = '/api/admin/export?scope=ordens' }: DashboardHeaderActionsProps) {
  const router = useRouter()

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={() => router.refresh()}>
        <RefreshCcw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
      <Button asChild type="button" variant="outline">
        <a href={exportHref}>
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </a>
      </Button>
    </div>
  )
}
