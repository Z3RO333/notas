import { supabase } from '../config/supabase';
import { SyncResult } from '../types';

/**
 * Registra uma execucao do job de sync
 */
export async function registrarExecucao(result: SyncResult, watermark: string | null): Promise<void> {
  const { error } = await supabase
    .from('log_execucoes')
    .insert({
      qtd_novas: result.qtdNovas,
      qtd_atribuidas: result.qtdAtribuidas,
      erros: result.erros.length > 0 ? result.erros.join('\n') : null,
      watermark: watermark,
      duracao_ms: result.duracaoMs,
    });

  if (error) {
    console.error('Erro ao registrar execucao:', error);
    throw error;
  }
}

/**
 * Busca as ultimas execucoes (para debug/monitoramento)
 */
export async function getUltimasExecucoes(limite: number = 10) {
  const { data, error } = await supabase
    .from('log_execucoes')
    .select('*')
    .order('executado_em', { ascending: false })
    .limit(limite);

  if (error) {
    console.error('Erro ao buscar execucoes:', error);
    throw error;
  }

  return data;
}
