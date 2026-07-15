'use client'

import { useEffect, useState } from 'react'
import { HardHat, ChevronDown, ChevronUp } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { buscarOperacionaisEmCampo, type OperacionalEmCampo } from '@/lib/actions/operacionais-em-campo-actions'

export function OperacionaisEmCampoDialog() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<OperacionalEmCampo[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    buscarOperacionaisEmCampo()
      .then((rows) => {
        setData(rows)
        setLoading(false)
      })
      .catch(() => {
        setData([])
        setLoading(false)
      })
  }, [open])

  function toggleExpand(codigo: string) {
    setExpanded((prev) => (prev === codigo ? null : codigo))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <HardHat className="mr-2 h-3.5 w-3.5" />
          Em Campo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Operacionais em Campo</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        )}

        {!loading && data.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum operacional em execução no momento.</p>
        )}

        {!loading && data.length > 0 && (
          <div className="divide-y">
            {data.map((op) => (
              <div key={op.fornecedor_codigo} className="py-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => toggleExpand(op.fornecedor_codigo)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{op.fornecedor_nome}</p>
                    <p className="text-xs text-muted-foreground">Cód. {op.fornecedor_codigo}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{op.total_em_campo} em execução</Badge>
                    {expanded === op.fornecedor_codigo ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {expanded === op.fornecedor_codigo && (
                  <div className="mt-2 space-y-2 pl-1">
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Unidades</p>
                      <div className="flex flex-wrap gap-1">
                        {op.unidades.map((u) => (
                          <Badge key={u} variant="outline" className="text-xs">
                            {u}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Ordens</p>
                      <p className="text-xs text-muted-foreground">{op.ordens.join(', ')}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
