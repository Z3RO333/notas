-- 00089_sincronizar_cockpit_convergencia.sql
-- Cria função que sincroniza notas_manutencao → notas_convergencia_cockpit.
-- Resolve: cockpit vazio pois tabela de convergência nunca foi alimentada no novo projeto.

-- ============================================================
-- Função principal de sincronização
-- ============================================================
CREATE OR REPLACE FUNCTION public.sincronizar_cockpit_convergencia(
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(inseridas INTEGER, atualizadas INTEGER, total_elegiveis INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridas  INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_elegiveis  INTEGER := 0;
BEGIN
  -- Upsert de todas as notas de notas_manutencao.
  -- Critério de tem_ordem_vinculada (duplo):
  --   1) ordem_sap IS NOT NULL (vínculo direto do qmel_clean)
  --   2) OR existe ordem ativa em ordens_notas_acompanhamento
  --      (status NOT IN concluida/cancelada)

  WITH source AS (
    SELECT
      nm.numero_nota,
      -- normaliza: remove zeros à esquerda quando todo numérico
      CASE
        WHEN nm.numero_nota ~ '^\d+$'
          THEN LTRIM(nm.numero_nota, '0')
        ELSE nm.numero_nota
      END AS numero_nota_norm,
      nm.id                    AS nota_id,
      nm.ordem_sap,
      nm.status,
      nm.descricao,
      nm.centro,
      nm.administrador_id,
      nm.data_criacao_sap,
      nm.updated_at            AS source_updated_at,
      -- tem_ordem_vinculada: SAP direto OU ordem ativa em acompanhamento
      (
        nm.ordem_sap IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.ordens_notas_acompanhamento o
          WHERE o.nota_id = nm.id
            AND o.status_ordem NOT IN ('concluida', 'cancelada')
        )
      )                        AS tem_ordem_vinculada,
      -- status_elegivel: notas em aberto operacionalmente
      nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') AS status_elegivel
    FROM public.notas_manutencao nm
  ),
  computed AS (
    SELECT
      s.*,
      -- eligible_cockpit: aberta + sem ordem vinculada
      (s.status_elegivel AND NOT s.tem_ordem_vinculada) AS eligible_cockpit,
      -- estado_operacional
      CASE
        WHEN s.tem_ordem_vinculada              THEN 'COM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status = 'cancelada'             THEN 'CANCELADA'::public.cockpit_estado_operacional
        WHEN s.status = 'concluida'             THEN 'ENCERRADA_SEM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status_elegivel AND NOT s.tem_ordem_vinculada
                                                THEN 'COCKPIT_PENDENTE'::public.cockpit_estado_operacional
        ELSE                                         'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional
      END AS estado_operacional,
      -- reason_not_eligible (primeiro motivo aplicável)
      CASE
        WHEN s.tem_ordem_vinculada              THEN 'ORDEM_ATIVA_VINCULADA'
        WHEN s.status = 'cancelada'             THEN 'NOTA_CANCELADA'
        WHEN s.status = 'concluida'             THEN 'NOTA_CONCLUIDA'
        WHEN NOT s.status_elegivel              THEN 'STATUS_FECHADO'
        ELSE NULL
      END AS reason_not_eligible,
      -- reason_codes (todos motivos aplicáveis)
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.tem_ordem_vinculada THEN 'ORDEM_ATIVA_VINCULADA' END,
        CASE WHEN NOT s.status_elegivel THEN 'STATUS_FECHADO'        END
      ], NULL) AS reason_codes
    FROM source s
  )
  INSERT INTO public.notas_convergencia_cockpit (
    numero_nota,
    numero_nota_norm,
    nota_id,
    ordem_sap,
    status,
    descricao,
    centro,
    administrador_id,
    data_criacao_sap,
    tem_qmel,
    tem_pmpl,
    tem_mestre,
    status_elegivel,
    tem_ordem_vinculada,
    eligible_cockpit,
    estado_operacional,
    reason_not_eligible,
    reason_codes,
    sync_id,
    source_updated_at
  )
  SELECT
    c.numero_nota,
    c.numero_nota_norm,
    c.nota_id,
    c.ordem_sap,
    c.status,
    c.descricao,
    c.centro,
    c.administrador_id,
    c.data_criacao_sap,
    true  AS tem_qmel,   -- toda nota em notas_manutencao veio do qmel_clean
    false AS tem_pmpl,   -- não bloqueia elegibilidade por ora
    false AS tem_mestre, -- não bloqueia elegibilidade por ora
    c.status_elegivel,
    c.tem_ordem_vinculada,
    c.eligible_cockpit,
    c.estado_operacional,
    c.reason_not_eligible,
    c.reason_codes,
    p_sync_id,
    c.source_updated_at
  FROM computed c
  ON CONFLICT (numero_nota) DO UPDATE SET
    numero_nota_norm    = EXCLUDED.numero_nota_norm,
    nota_id             = EXCLUDED.nota_id,
    ordem_sap           = EXCLUDED.ordem_sap,
    status              = EXCLUDED.status,
    descricao           = EXCLUDED.descricao,
    centro              = EXCLUDED.centro,
    administrador_id    = EXCLUDED.administrador_id,
    data_criacao_sap    = EXCLUDED.data_criacao_sap,
    tem_qmel            = EXCLUDED.tem_qmel,
    status_elegivel     = EXCLUDED.status_elegivel,
    tem_ordem_vinculada = EXCLUDED.tem_ordem_vinculada,
    eligible_cockpit    = EXCLUDED.eligible_cockpit,
    estado_operacional  = EXCLUDED.estado_operacional,
    reason_not_eligible = EXCLUDED.reason_not_eligible,
    reason_codes        = EXCLUDED.reason_codes,
    sync_id             = EXCLUDED.sync_id,
    source_updated_at   = EXCLUDED.source_updated_at,
    updated_at          = now()
  WHERE
    notas_convergencia_cockpit.eligible_cockpit    IS DISTINCT FROM EXCLUDED.eligible_cockpit
    OR notas_convergencia_cockpit.status           IS DISTINCT FROM EXCLUDED.status
    OR notas_convergencia_cockpit.administrador_id IS DISTINCT FROM EXCLUDED.administrador_id
    OR notas_convergencia_cockpit.ordem_sap        IS DISTINCT FROM EXCLUDED.ordem_sap
    OR notas_convergencia_cockpit.tem_ordem_vinculada IS DISTINCT FROM EXCLUDED.tem_ordem_vinculada
    OR notas_convergencia_cockpit.estado_operacional  IS DISTINCT FROM EXCLUDED.estado_operacional;

  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  SELECT COUNT(*) INTO v_elegiveis
  FROM public.notas_convergencia_cockpit
  WHERE eligible_cockpit = true;

  RETURN QUERY SELECT v_inseridas, v_atualizadas, v_elegiveis;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_cockpit_convergencia(UUID) IS
  'Sincroniza notas_manutencao → notas_convergencia_cockpit. '
  'Computa eligible_cockpit usando status aberto + ausência de ordem ativa (SAP direto ou ordens_notas_acompanhamento). '
  'Deve ser chamada a cada ciclo do sync job.';

-- ============================================================
-- Execução imediata: popula com estado atual (~150 notas ativas)
-- ============================================================
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.sincronizar_cockpit_convergencia(NULL);
  RAISE NOTICE 'sincronizar_cockpit_convergencia: inseridas/atualizadas=% elegiveis=%',
    v_result.inseridas, v_result.total_elegiveis;
END;
$$;
