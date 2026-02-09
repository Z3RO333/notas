import { useState, useCallback } from 'react';
import { supabase, CargaAdmin, Demanda } from '../lib/supabase';
import { usePolling } from '../hooks/usePolling';
import { TabelaCarga } from '../components/TabelaCarga';
import { CardDemanda } from '../components/CardDemanda';

interface LogExecucao {
  id: string;
  executado_em: string;
  qtd_novas: number;
  qtd_atribuidas: number;
  erros: string | null;
  duracao_ms: number | null;
}

export function Geral() {
  const [admins, setAdmins] = useState<CargaAdmin[]>([]);
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [ultimaExecucao, setUltimaExecucao] = useState<LogExecucao | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [tab, setTab] = useState<'carga' | 'nao_atribuidas' | 'todas'>('carga');

  const fetchData = useCallback(async () => {
    // Busca carga dos admins
    const { data: cargaData } = await supabase
      .from('carga_admins')
      .select('*')
      .eq('ativo', true);

    setAdmins(cargaData || []);

    // Busca demandas (nao atribuidas ou todas)
    let query = supabase
      .from('demandas')
      .select('*')
      .order('data_criacao_sap', { ascending: true });

    if (tab === 'nao_atribuidas') {
      query = query.is('admin_id', null);
    }

    const { data: demandasData } = await query.limit(100);
    setDemandas(demandasData || []);

    // Busca ultima execucao
    const { data: logData } = await supabase
      .from('log_execucoes')
      .select('*')
      .order('executado_em', { ascending: false })
      .limit(1)
      .single();

    setUltimaExecucao(logData);

    setLastUpdate(new Date());
    setLoading(false);
  }, [tab]);

  const { refresh } = usePolling(fetchData, { interval: 15000 });

  // Totais
  const totalDemandas = admins.reduce(
    (acc, a) => acc + a.carga_atual,
    0
  );
  const demandasNaoAtribuidas = demandas.filter((d) => !d.admin_id).length;

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
          <h1 className="text-2xl font-bold text-gray-900">Visao Geral</h1>
          <p className="text-sm text-gray-500">
            Distribuicao de notas entre admins
          </p>
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

      {/* Status do sistema */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-gray-900">{admins.length}</div>
          <div className="text-sm text-gray-500">Admins Ativos</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-blue-600">{totalDemandas}</div>
          <div className="text-sm text-gray-500">Demandas em Aberto</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-orange-600">
            {demandasNaoAtribuidas}
          </div>
          <div className="text-sm text-gray-500">Nao Atribuidas</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Ultima Sincronizacao</div>
          <div className="text-lg font-semibold text-gray-900">
            {ultimaExecucao
              ? new Date(ultimaExecucao.executado_em).toLocaleTimeString('pt-BR')
              : '-'}
          </div>
          {ultimaExecucao && (
            <div className="text-xs text-gray-400">
              +{ultimaExecucao.qtd_novas} novas, +{ultimaExecucao.qtd_atribuidas}{' '}
              atribuidas
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {[
          { value: 'carga', label: 'Carga por Admin' },
          { value: 'nao_atribuidas', label: 'Nao Atribuidas' },
          { value: 'todas', label: 'Todas as Demandas' },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value as typeof tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.value
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteudo */}
      {tab === 'carga' && <TabelaCarga admins={admins} />}

      {(tab === 'nao_atribuidas' || tab === 'todas') && (
        <>
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
        </>
      )}
    </div>
  );
}
