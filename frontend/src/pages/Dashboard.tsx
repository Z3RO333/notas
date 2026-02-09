import { useState, useCallback } from 'react';
import { supabase, CargaAdmin } from '../lib/supabase';
import { usePolling } from '../hooks/usePolling';

interface LogExecucao {
  id: string;
  executado_em: string;
  qtd_novas: number;
  qtd_atribuidas: number;
  erros: string | null;
  duracao_ms: number | null;
}

export function Dashboard() {
  const [admins, setAdmins] = useState<CargaAdmin[]>([]);
  const [logs, setLogs] = useState<LogExecucao[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    // Busca carga dos admins
    const { data: cargaData } = await supabase
      .from('carga_admins')
      .select('*')
      .eq('ativo', true);

    setAdmins(cargaData || []);

    // Busca ultimas execucoes
    const { data: logsData } = await supabase
      .from('log_execucoes')
      .select('*')
      .order('executado_em', { ascending: false })
      .limit(20);

    setLogs(logsData || []);
    setLoading(false);
  }, []);

  usePolling(fetchData, { interval: 30000 });

  // Calcula metricas
  const totalCarga = admins.reduce((acc, a) => acc + a.carga_atual, 0);
  const mediaCargas = admins.length > 0 ? totalCarga / admins.length : 0;
  const maxCarga = Math.max(...admins.map((a) => a.carga_atual), 0);
  const minCarga = Math.min(...admins.map((a) => a.carga_atual), 0);
  const desvio = maxCarga - minCarga;

  // Calcula metricas das ultimas execucoes
  const ultimasHoras = logs.filter((l) => {
    const diff = Date.now() - new Date(l.executado_em).getTime();
    return diff < 3600000; // 1 hora
  });
  const notasUltimaHora = ultimasHoras.reduce((acc, l) => acc + l.qtd_novas, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* KPIs principais */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-3xl font-bold text-gray-900">{totalCarga}</div>
          <div className="text-sm text-gray-500">Total em Aberto</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-3xl font-bold text-blue-600">
            {mediaCargas.toFixed(1)}
          </div>
          <div className="text-sm text-gray-500">Media por Admin</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div
            className={`text-3xl font-bold ${
              desvio <= 2 ? 'text-green-600' : desvio <= 5 ? 'text-yellow-600' : 'text-red-600'
            }`}
          >
            {desvio}
          </div>
          <div className="text-sm text-gray-500">Desvio (Max - Min)</div>
          <div className="text-xs text-gray-400 mt-1">
            {desvio <= 2 ? 'Equilibrado' : desvio <= 5 ? 'Aceitavel' : 'Desbalanceado'}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-3xl font-bold text-purple-600">
            {notasUltimaHora}
          </div>
          <div className="text-sm text-gray-500">Notas (ultima hora)</div>
        </div>
      </div>

      {/* Distribuicao visual */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Distribuicao de Carga</h2>
        <div className="space-y-3">
          {admins
            .sort((a, b) => b.carga_atual - a.carga_atual)
            .map((admin) => {
              const percentual = maxCarga > 0 ? (admin.carga_atual / maxCarga) * 100 : 0;
              return (
                <div key={admin.id} className="flex items-center gap-4">
                  <div className="w-32 text-sm text-gray-700 truncate">
                    {admin.nome}
                  </div>
                  <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        admin.carga_atual === minCarga
                          ? 'bg-green-500'
                          : admin.carga_atual === maxCarga && desvio > 2
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${percentual}%` }}
                    />
                  </div>
                  <div className="w-12 text-sm font-medium text-gray-900 text-right">
                    {admin.carga_atual}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Historico de execucoes */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Historico de Sincronizacoes</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Data/Hora
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Novas
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Atribuidas
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Duracao
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {new Date(log.executado_em).toLocaleString('pt-BR')}
                </td>
                <td className="px-6 py-4 text-center text-sm text-blue-600">
                  +{log.qtd_novas}
                </td>
                <td className="px-6 py-4 text-center text-sm text-green-600">
                  +{log.qtd_atribuidas}
                </td>
                <td className="px-6 py-4 text-center text-sm text-gray-500">
                  {log.duracao_ms ? `${log.duracao_ms}ms` : '-'}
                </td>
                <td className="px-6 py-4 text-center">
                  {log.erros ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                      Erro
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
