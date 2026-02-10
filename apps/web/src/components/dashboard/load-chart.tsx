'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { CargaAdministrador } from '@/lib/types/database'

interface LoadChartProps {
  carga: CargaAdministrador[]
}

export function LoadChart({ carga }: LoadChartProps) {
  const data = carga.map((admin) => ({
    nome: admin.nome.split(' ')[0], // Primeiro nome para caber no grafico
    Nova: admin.qtd_nova,
    'Em Andamento': admin.qtd_em_andamento,
    Encaminhada: admin.qtd_encaminhada,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Carga por Administrador</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="nome" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Nova" stackId="a" fill="#3b82f6" />
              <Bar dataKey="Em Andamento" stackId="a" fill="#eab308" />
              <Bar dataKey="Encaminhada" stackId="a" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
