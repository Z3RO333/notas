-- 00078_fix_vw_notas_sem_ordem_index_and_rewrite.sql
--
-- Problema:
--   Após o commit a11ae1f (dual-source QM+QMEL), o sync job passou a
--   preencher ordem_sap em todas as notas com vínculo histórico SAP,
--   inclusive notas cujas ordens já foram concluídas ou canceladas.
--   A view vw_notas_sem_ordem filtrava por "ordem_sap IS NULL", fazendo
--   94.910 notas desaparecerem do cockpit mesmo sem ordem ativa.
--
-- Correção:
--   1. Índice composto (nota_id, status_ordem) para performance no NOT EXISTS
--   2. Rewrite da view: remove filtro ordem_sap IS NULL, usa dois NOT EXISTS
--      separados (FK direto + fallback texto) com filtro status_ordem ativo.
--
-- Resultado: vw_notas_sem_ordem retorna ~94.935 notas abertas sem ordem ativa.

CREATE INDEX IF NOT EXISTS idx_ordens_nota_id_status_ativo
  ON public.ordens_notas_acompanhamento (nota_id, status_ordem)
  WHERE nota_id IS NOT NULL;

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
  -- Sem ordem ATIVA por FK (caminho rápido — usa idx_ordens_nota_id_status_ativo)
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
  'Notas abertas sem ordem ATIVA vinculada (FK ou numero_nota). '
  'Exclui somente ordens ativas (status != concluida/cancelada). '
  'Fix 00078: índice + rewrite para performance em 94k+ notas.';
