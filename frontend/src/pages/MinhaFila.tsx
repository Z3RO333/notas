import { useState, useCallback } from 'react';
import { supabase, Demanda } from '../lib/supabase';
import { usePolling } from '../hooks/usePolling';
import { CardDemanda } from '../components/CardDemanda';

interface MinhaFilaProps {
  adminEmail: string;
}

export function MinhaFila({ adminEmail }: MinhaFilaProps) {
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<string>('abertas');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchDemandas = useCallback(async () => {
    // Primeiro busca o admin pelo email
    const { data: admin } = await supabase
      .from('admins')
      .select('id')
      .eq('email', adminEmail)
      .single();

    if (!admin) {
      console.error('Admin nao encontrado:', adminEmail);
      setLoading(false);
      return;
    }

    // Busca demandas do admin
    let query = supabase
      .from('demandas')
      .select('*')
      .eq('admin_id', admin.id)
      .order('data_criacao_sap', { ascending: true });

    // Filtro de status
    if (filtroStatus === 'abertas') {
      query = query.in('status', ['nova', 'em_andamento', 'encaminhada']);
    } else if (filtroStatus !== 'todas') {
      query = query.eq('status', filtroStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar demandas:', error);
      return;
    }

    setDemandas(data || []);
    setLastUpdate(new Date());
    setLoading(false);
  }, [adminEmail, filtroStatus]);

  const { refresh } = usePolling(fetchDemandas, { interval: 15000 });

  // Conta por status
  const contagem = demandas.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minha Fila</h1>
          <p className="text-sm text-gray-500">{adminEmail}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">
            Atualizado: {lastUpdate?.toLocaleTimeString('pt-BR')}
          </span>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded transition"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-600">{contagem.nova || 0}</div>
          <div className="text-sm text-blue-500">Novas</div>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-600">
            {contagem.em_andamento || 0}
          </div>
          <div className="text-sm text-yellow-500">Em Andamento</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-600">
            {contagem.encaminhada || 0}
          </div>
          <div className="text-sm text-purple-500">Encaminhadas</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-600">
            {contagem.concluida || 0}
          </div>
          <div className="text-sm text-green-500">Concluidas</div>
        </div>
      </div>

      {/* Filtro */}
      <div className="flex gap-2">
        {[
          { value: 'abertas', label: 'Abertas' },
          { value: 'nova', label: 'Novas' },
          { value: 'em_andamento', label: 'Em Andamento' },
          { value: 'encaminhada', label: 'Encaminhadas' },
          { value: 'concluida', label: 'Concluidas' },
          { value: 'todas', label: 'Todas' },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFiltroStatus(f.value)}
            className={`px-3 py-1.5 text-sm rounded transition ${
              filtroStatus === f.value
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de demandas */}
      {demandas.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          Nenhuma demanda encontrada
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {demandas.map((demanda) => (
            <CardDemanda key={demanda.id} demanda={demanda} onUpdate={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
