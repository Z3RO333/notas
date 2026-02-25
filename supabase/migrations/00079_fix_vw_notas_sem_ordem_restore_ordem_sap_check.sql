-- 00079_fix_vw_notas_sem_ordem_restore_ordem_sap_check.sql
--
-- Problema:
--   Migration 00078 removeu o filtro ordem_sap IS NULL da view vw_notas_sem_ordem
--   para corrigir o desaparecimento de 94k notas. Resultado inesperado: 94.935 notas
--   aparecem como "sem ordem" mesmo tendo ordens SAP (ordem_sap preenchido).
--   Diagnóstico confirmado: 94.914 das notas na view têm ordem_sap preenchido,
--   com ZERO entradas correspondentes em ordens_notas_acompanhamento por FK.
--   SAP ground truth: apenas ~21 notas abertas são genuinamente sem ordem.
--
-- Correção:
--   Restaura (ordem_sap IS NULL OR TRIM=''/0') como filtro primário.
--   Mantém os NOT EXISTS de 00078 para ordens gerenciadas pelo cockpit.
--   Mantém índice idx_ordens_nota_id_status_ativo (criado em 00078, não recriado).
--   Adiciona índice parcial em notas_manutencao para o novo filtro de ordem_sap.
--
-- Resultado esperado:
--   vw_notas_sem_ordem retorna > 100 notas após próximo sync completo
--   (vs 94.935 antes do fix). Se retornar < 50, verificar sync de ordem_sap.

CREATE INDEX IF NOT EXISTS idx_notas_manutencao_ordem_sap_null
  ON public.notas_manutencao (id)
  WHERE (ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000'));

CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT
  id, numero_nota, tipo_nota, descricao, descricao_objeto,
  prioridade, tipo_prioridade, criado_por_sap, solicitante,
  data_criacao_sap, data_nota, hora_nota, ordem_sap, centro,
  status_sap, conta_fornecedor, autor_nota, streaming_timestamp,
  status, administrador_id, distribuida_em, ordem_gerada,
  fornecedor_encaminhado, observacoes, sync_id, raw_data,
  created_at, updated_at
FROM public.notas_manutencao n
WHERE status = ANY (ARRAY[
    'nova'::nota_status,
    'em_andamento'::nota_status,
    'encaminhada_fornecedor'::nota_status
  ])
  -- Nota genuinamente sem ordem SAP (campo ordem_sap nulo ou vazio)
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  -- Sem ordem ATIVA por FK (caminho rápido — usa idx_ordens_nota_id_status_ativo de 00078)
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  )
  -- Sem ordem ATIVA por numero_nota (fallback para ordens sem FK)
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(ltrim(btrim(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  );

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Notas abertas genuinamente sem ordem SAP (ordem_sap IS NULL/vazio) '
  'e sem ordem ativa no cockpit (ordens_notas_acompanhamento). '
  'Fix 00079: restaura ordem_sap IS NULL removido em 00078. '
  'Resultado esperado: > 100 notas após sync (vs 94.935 antes).';
