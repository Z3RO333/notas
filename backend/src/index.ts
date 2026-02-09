import * as dotenv from 'dotenv';
dotenv.config();

import {
  getLastWatermark,
  fetchNotasFromDatabricks,
  upsertDemandas,
  getNewWatermark,
} from './services/sync.service';
import { distribuirDemandas } from './services/distribuicao.service';
import { registrarExecucao } from './services/log.service';
import { SyncResult } from './types';

async function main(): Promise<void> {
  const inicio = Date.now();
  console.log('='.repeat(50));
  console.log(`[${new Date().toISOString()}] Iniciando sincronizacao...`);
  console.log('='.repeat(50));

  const result: SyncResult = {
    success: false,
    qtdNovas: 0,
    qtdAtribuidas: 0,
    erros: [],
    duracaoMs: 0,
  };

  let newWatermark: string | null = null;

  try {
    // 1. Busca ultimo watermark
    const lastWatermark = await getLastWatermark();
    console.log(`Ultimo watermark: ${lastWatermark || 'nenhum (primeira execucao)'}`);

    // 2. Busca notas novas do Databricks
    console.log('Buscando notas do Databricks...');
    const notas = await fetchNotasFromDatabricks(lastWatermark);
    console.log(`Encontradas ${notas.length} nota(s) nova(s)`);

    // 3. Insere/atualiza no Supabase
    if (notas.length > 0) {
      console.log('Inserindo demandas no Supabase...');
      result.qtdNovas = await upsertDemandas(notas);
      console.log(`Inseridas ${result.qtdNovas} demanda(s)`);

      // Atualiza watermark
      newWatermark = getNewWatermark(notas);
    }

    // 4. Distribui demandas nao atribuidas
    console.log('Distribuindo demandas...');
    result.qtdAtribuidas = await distribuirDemandas();
    console.log(`Atribuidas ${result.qtdAtribuidas} demanda(s)`);

    result.success = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.erros.push(errorMessage);
    console.error('ERRO:', errorMessage);
  }

  // 5. Registra execucao
  result.duracaoMs = Date.now() - inicio;

  try {
    await registrarExecucao(result, newWatermark);
  } catch (error) {
    console.error('Erro ao registrar log:', error);
  }

  // Resumo
  console.log('='.repeat(50));
  console.log('RESUMO:');
  console.log(`  Sucesso: ${result.success}`);
  console.log(`  Notas novas: ${result.qtdNovas}`);
  console.log(`  Atribuidas: ${result.qtdAtribuidas}`);
  console.log(`  Duracao: ${result.duracaoMs}ms`);
  if (result.erros.length > 0) {
    console.log(`  Erros: ${result.erros.join(', ')}`);
  }
  console.log('='.repeat(50));

  // Exit code
  process.exit(result.success ? 0 : 1);
}

main();
