import { supabase } from '../config/supabase';
import { CargaAdmin, Demanda } from '../types';

/**
 * Busca a carga atual de todos os admins ativos
 */
export async function getCargaAdmins(): Promise<CargaAdmin[]> {
  const { data, error } = await supabase
    .from('carga_admins')
    .select('*')
    .eq('ativo', true);

  if (error) {
    console.error('Erro ao buscar carga dos admins:', error);
    throw error;
  }

  return data || [];
}

/**
 * Escolhe o admin com menor carga disponivel
 * Criterio: menor carga_atual, depois por ultima_atribuicao mais antiga
 */
export function escolherAdminMenorCarga(admins: CargaAdmin[]): CargaAdmin | null {
  // Filtra admins que nao atingiram limite
  const disponiveis = admins.filter(a => a.carga_atual < a.limite_max);

  if (disponiveis.length === 0) {
    return null;
  }

  // Ordena por carga_atual ASC, ultima_atribuicao ASC (null primeiro)
  disponiveis.sort((a, b) => {
    // Primeiro por carga
    if (a.carga_atual !== b.carga_atual) {
      return a.carga_atual - b.carga_atual;
    }

    // Empate: quem recebeu ha mais tempo (ou nunca recebeu)
    if (!a.ultima_atribuicao && !b.ultima_atribuicao) return 0;
    if (!a.ultima_atribuicao) return -1;
    if (!b.ultima_atribuicao) return 1;

    return new Date(a.ultima_atribuicao).getTime() - new Date(b.ultima_atribuicao).getTime();
  });

  return disponiveis[0];
}

/**
 * Busca demandas que ainda nao foram atribuidas
 */
export async function getDemandasNaoAtribuidas(): Promise<Demanda[]> {
  const { data, error } = await supabase
    .from('demandas')
    .select('*')
    .is('admin_id', null)
    .order('data_criacao_sap', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erro ao buscar demandas nao atribuidas:', error);
    throw error;
  }

  return data || [];
}

/**
 * Atribui uma demanda a um admin
 */
export async function atribuirDemanda(demandaId: string, adminId: string): Promise<void> {
  const { error } = await supabase
    .from('demandas')
    .update({
      admin_id: adminId,
      atribuido_em: new Date().toISOString(),
    })
    .eq('id', demandaId)
    .is('admin_id', null); // Garante que ainda nao foi atribuida

  if (error) {
    console.error('Erro ao atribuir demanda:', error);
    throw error;
  }
}

/**
 * Distribui todas as demandas nao atribuidas entre os admins
 * Retorna o numero de atribuicoes feitas
 */
export async function distribuirDemandas(): Promise<number> {
  const demandas = await getDemandasNaoAtribuidas();

  if (demandas.length === 0) {
    console.log('Nenhuma demanda para distribuir');
    return 0;
  }

  console.log(`Distribuindo ${demandas.length} demanda(s)...`);

  let atribuidas = 0;

  for (const demanda of demandas) {
    // Busca carga atualizada a cada iteracao (para considerar atribuicoes anteriores)
    const admins = await getCargaAdmins();
    const adminEscolhido = escolherAdminMenorCarga(admins);

    if (!adminEscolhido) {
      console.warn(`Nenhum admin disponivel para demanda ${demanda.numero_nota}`);
      continue;
    }

    await atribuirDemanda(demanda.id, adminEscolhido.id);
    console.log(`Nota ${demanda.numero_nota} -> ${adminEscolhido.nome} (carga: ${adminEscolhido.carga_atual + 1})`);
    atribuidas++;
  }

  return atribuidas;
}
