import { Demanda, supabase } from '../lib/supabase';
import { StatusBadge } from './StatusBadge';

interface CardDemandaProps {
  demanda: Demanda;
  onUpdate?: () => void;
}

export function CardDemanda({ demanda, onUpdate }: CardDemandaProps) {
  const handleStatusChange = async (novoStatus: Demanda['status']) => {
    const { error } = await supabase
      .from('demandas')
      .update({ status: novoStatus })
      .eq('id', demanda.id);

    if (error) {
      console.error('Erro ao atualizar status:', error);
      alert('Erro ao atualizar status');
      return;
    }

    onUpdate?.();
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {demanda.numero_nota}
          </h3>
          <p className="text-sm text-gray-500">{demanda.tipo_nota}</p>
        </div>
        <StatusBadge status={demanda.status} />
      </div>

      <p className="text-sm text-gray-700 mb-3 line-clamp-2">
        {demanda.texto_breve || 'Sem descricao'}
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-4">
        <div>
          <span className="font-medium">Centro:</span> {demanda.centro_material || '-'}
        </div>
        <div>
          <span className="font-medium">Prioridade:</span> {demanda.prioridade || '-'}
        </div>
        <div>
          <span className="font-medium">Criado por:</span> {demanda.criado_por || '-'}
        </div>
        <div>
          <span className="font-medium">Data:</span> {formatDate(demanda.data_criacao_sap)}
        </div>
      </div>

      {/* Acoes */}
      <div className="flex gap-2 pt-3 border-t border-gray-100">
        {demanda.status === 'nova' && (
          <button
            onClick={() => handleStatusChange('em_andamento')}
            className="flex-1 px-3 py-1.5 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600 transition"
          >
            Iniciar
          </button>
        )}
        {demanda.status === 'em_andamento' && (
          <>
            <button
              onClick={() => handleStatusChange('encaminhada')}
              className="flex-1 px-3 py-1.5 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 transition"
            >
              Encaminhar
            </button>
            <button
              onClick={() => handleStatusChange('concluida')}
              className="flex-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition"
            >
              Concluir
            </button>
          </>
        )}
        {demanda.status === 'encaminhada' && (
          <button
            onClick={() => handleStatusChange('concluida')}
            className="flex-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition"
          >
            Concluir
          </button>
        )}
      </div>
    </div>
  );
}
