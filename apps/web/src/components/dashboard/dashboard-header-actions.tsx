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
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
        <RefreshCcw className="h-4 w-4" />
        Atualizar
      </Button>
      <Button asChild type="button" variant="outline" size="sm">
        <a href={exportHref}>
          <Download className="h-4 w-4" />
          Exportar
        </a>
      </Button>
    </div>
  )
}
