import { createDatabricksClient, databricksTable } from '../config/databricks';
import { supabase } from '../config/supabase';
import { NotaDatabricks, Demanda } from '../types';

/**
 * Busca o ultimo watermark (DATA_CRIACAO mais recente sincronizada)
 */
export async function getLastWatermark(): Promise<string | null> {
  const { data, error } = await supabase
    .from('log_execucoes')
    .select('watermark')
    .order('executado_em', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data.watermark;
}

/**
 * Busca notas novas do Databricks desde o watermark
 */
export async function fetchNotasFromDatabricks(watermark: string | null): Promise<NotaDatabricks[]> {
  const client = await createDatabricksClient();

  try {
    const session = await client.openSession();

    let query = `SELECT * FROM ${databricksTable}`;

    if (watermark) {
      // Busca notas criadas depois do watermark
      query += ` WHERE DATA_CRIACAO > '${watermark}' OR (DATA_CRIACAO = '${watermark}' AND HORA_CRIACAO_REG > (SELECT MAX(HORA_CRIACAO_REG) FROM ${databricksTable} WHERE DATA_CRIACAO = '${watermark}'))`;
    }

    query += ` ORDER BY DATA_CRIACAO ASC, HORA_CRIACAO_REG ASC`;

    const operation = await session.executeStatement(query);
    const result = await operation.fetchAll();

    await operation.close();
    await session.close();

    return result as NotaDatabricks[];
  } finally {
    await client.close();
  }
}

/**
 * Converte nota do Databricks para formato do Supabase
 */
function mapNotaToDemanda(nota: NotaDatabricks): Partial<Demanda> {
  return {
    numero_nota: nota.NUMERO_NOTA,
    tipo_nota: nota.TIPO_NOTA,
    texto_breve: nota.TEXTO_BREVE,
    prioridade: nota.PRIORIDADE,
    tipo_prioridade: nota.TIPO_PRIORIDADE,
    centro_material: nota.CENTRO_MATERIAL,
    criado_por: nota.CRIADO_POR,
    data_criacao_sap: nota.DATA_CRIACAO,
    status: 'nova',
    dados_originais: nota as Record<string, unknown>,
  };
}

/**
 * Insere/atualiza demandas no Supabase (upsert por numero_nota)
 */
export async function upsertDemandas(notas: NotaDatabricks[]): Promise<number> {
  if (notas.length === 0) {
    return 0;
  }

  const demandas = notas.map(mapNotaToDemanda);

  // Upsert em lotes de 100
  const batchSize = 100;
  let totalInseridas = 0;

  for (let i = 0; i < demandas.length; i += batchSize) {
    const batch = demandas.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('demandas')
      .upsert(batch, {
        onConflict: 'numero_nota',
        ignoreDuplicates: true, // Nao atualiza se ja existe
      })
      .select('id');

    if (error) {
      console.error('Erro ao inserir demandas:', error);
      throw error;
    }

    totalInseridas += data?.length || 0;
  }

  return totalInseridas;
}

/**
 * Retorna o watermark mais recente das notas processadas
 */
export function getNewWatermark(notas: NotaDatabricks[]): string | null {
  if (notas.length === 0) {
    return null;
  }

  // Pega a DATA_CRIACAO mais recente
  const ultima = notas.reduce((max, nota) => {
    const dataAtual = nota.DATA_CRIACAO || '';
    const dataMax = max.DATA_CRIACAO || '';
    return dataAtual > dataMax ? nota : max;
  }, notas[0]);

  return ultima.DATA_CRIACAO;
}
