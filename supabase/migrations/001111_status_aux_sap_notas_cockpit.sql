-- 00111_status_aux_sap_notas_cockpit.sql
-- Enriquecimento temporário de status de notas via planilha SAP (chave: numero_nota_norm).
-- Objetivo: diferenciar melhor notas abertas vs canceladas enquanto a coluna oficial
-- ainda não está disponível na fonte principal do Databricks.

-- ============================================================
-- 1) Tabela auxiliar "current state" por nota normalizada
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notas_status_sap_aux (
  numero_nota_norm TEXT PRIMARY KEY,
  numero_nota_original TEXT NOT NULL,
  status_raw TEXT NOT NULL,
  status_canonico TEXT NOT NULL
    CHECK (status_canonico IN ('ABERTA', 'CANCELADA', 'VIROU_ORDEM', 'INDEFINIDA')),
  data_exportacao DATE,
  arquivo_origem TEXT,
  lote_id UUID NOT NULL,
  sync_id UUID REFERENCES public.sync_log(id) ON DELETE SET NULL,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notas_status_sap_aux_updated'
  ) THEN
    CREATE TRIGGER trg_notas_status_sap_aux_updated
      BEFORE UPDATE ON public.notas_status_sap_aux
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notas_status_sap_aux_status_canonico
  ON public.notas_status_sap_aux (status_canonico);

CREATE INDEX IF NOT EXISTS idx_notas_status_sap_aux_importado_em
  ON public.notas_status_sap_aux (importado_em DESC);

COMMENT ON TABLE public.notas_status_sap_aux IS
  'Status auxiliar por número da nota (planilha SAP), atualizado por lote diário. '
  'Mantém 1 linha por numero_nota_norm (estado mais recente).';

COMMENT ON COLUMN public.notas_status_sap_aux.status_canonico IS
  'Status normalizado para uso operacional: ABERTA, CANCELADA, VIROU_ORDEM ou INDEFINIDA.';

ALTER TABLE public.notas_status_sap_aux ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) View canônica do status auxiliar (camada estável para joins)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_status_sap_aux_latest AS
SELECT
  numero_nota_norm,
  numero_nota_original,
  status_raw,
  status_canonico,
  data_exportacao,
  arquivo_origem,
  lote_id,
  sync_id,
  importado_em,
  created_at,
  updated_at
FROM public.notas_status_sap_aux;

ALTER VIEW public.vw_notas_status_sap_aux_latest SET (security_invoker = on);

-- ============================================================
-- 3) Convergência do cockpit com enriquecimento do status auxiliar
--    Regra de frescor: considera status auxiliar importado nas últimas 48h.
-- ============================================================
ALTER TABLE public.notas_convergencia_cockpit
  ADD COLUMN IF NOT EXISTS status_sap_aux TEXT,
  ADD COLUMN IF NOT EXISTS status_sap_aux_importado_em TIMESTAMPTZ;

COMMENT ON COLUMN public.notas_convergencia_cockpit.status_sap_aux IS
  'Status auxiliar canônico da planilha SAP (ABERTA/CANCELADA/INDEFINIDA), quando disponível e fresco.';

COMMENT ON COLUMN public.notas_convergencia_cockpit.status_sap_aux_importado_em IS
  'Timestamp de importação do status auxiliar SAP usado na convergência.';

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
  WITH notas_base AS (
    SELECT
      nm.numero_nota,
      CASE
        WHEN COALESCE(NULLIF(BTRIM(nm.numero_nota), ''), '') = '' THEN '0'
        WHEN BTRIM(nm.numero_nota) ~ '^\d+$'
          THEN COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
        ELSE BTRIM(nm.numero_nota)
      END AS numero_nota_norm,
      nm.id                    AS nota_id,
      nm.ordem_sap,
      nm.status,
      nm.descricao,
      nm.centro,
      nm.administrador_id,
      nm.data_criacao_sap,
      nm.updated_at            AS source_updated_at
    FROM public.notas_manutencao nm
  ),
  source AS (
    SELECT
      nb.numero_nota,
      nb.numero_nota_norm,
      nb.nota_id,
      nb.ordem_sap,
      nb.status,
      nb.descricao,
      nb.centro,
      nb.administrador_id,
      nb.data_criacao_sap,
      nb.source_updated_at,
      aux.status_canonico      AS status_sap_aux,
      aux.importado_em         AS status_sap_aux_importado_em,
      (
        nb.ordem_sap IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.ordens_notas_acompanhamento o
          WHERE o.nota_id = nb.nota_id
            AND o.status_ordem NOT IN ('concluida', 'cancelada')
        )
      )                        AS tem_ordem_vinculada,
      (
        nb.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        AND COALESCE(aux.status_canonico, 'INDEFINIDA') NOT IN ('CANCELADA', 'VIROU_ORDEM')
      )                        AS status_elegivel
    FROM notas_base nb
    LEFT JOIN public.vw_notas_status_sap_aux_latest aux
      ON aux.numero_nota_norm = nb.numero_nota_norm
     AND aux.importado_em >= now() - interval '48 hours'
  ),
  computed AS (
    SELECT
      s.*,
      (s.status_elegivel AND NOT s.tem_ordem_vinculada) AS eligible_cockpit,
      CASE
        WHEN s.tem_ordem_vinculada
          OR s.status_sap_aux = 'VIROU_ORDEM'   THEN 'COM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status = 'cancelada'
          OR s.status_sap_aux = 'CANCELADA'     THEN 'CANCELADA'::public.cockpit_estado_operacional
        WHEN s.status = 'concluida'             THEN 'ENCERRADA_SEM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status_elegivel AND NOT s.tem_ordem_vinculada
                                                THEN 'COCKPIT_PENDENTE'::public.cockpit_estado_operacional
        ELSE                                         'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional
      END AS estado_operacional,
      CASE
        WHEN s.tem_ordem_vinculada              THEN 'ORDEM_ATIVA_VINCULADA'
        WHEN s.status_sap_aux = 'VIROU_ORDEM'   THEN 'SAP_STATUS_VIROU_ORDEM'
        WHEN s.status = 'cancelada'             THEN 'NOTA_CANCELADA'
        WHEN s.status_sap_aux = 'CANCELADA'     THEN 'SAP_STATUS_CANCELADA'
        WHEN s.status = 'concluida'             THEN 'NOTA_CONCLUIDA'
        WHEN NOT s.status_elegivel              THEN 'STATUS_FECHADO'
        ELSE NULL
      END AS reason_not_eligible,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.tem_ordem_vinculada THEN 'ORDEM_ATIVA_VINCULADA' END,
        CASE WHEN s.status_sap_aux = 'VIROU_ORDEM' THEN 'SAP_STATUS_VIROU_ORDEM' END,
        CASE WHEN s.status = 'cancelada' THEN 'NOTA_CANCELADA' END,
        CASE WHEN s.status_sap_aux = 'CANCELADA' THEN 'SAP_STATUS_CANCELADA' END,
        CASE WHEN s.status = 'concluida' THEN 'NOTA_CONCLUIDA' END,
        CASE WHEN NOT s.status_elegivel THEN 'STATUS_FECHADO' END
      ], NULL) AS reason_codes
    FROM source s
  )
  INSERT INTO public.notas_convergencia_cockpit (
    numero_nota,
    numero_nota_norm,
    nota_id,
    ordem_sap,
    status,
    status_sap_aux,
    status_sap_aux_importado_em,
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
    c.status_sap_aux,
    c.status_sap_aux_importado_em,
    c.descricao,
    c.centro,
    c.administrador_id,
    c.data_criacao_sap,
    true  AS tem_qmel,
    false AS tem_pmpl,
    false AS tem_mestre,
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
    status_sap_aux      = EXCLUDED.status_sap_aux,
    status_sap_aux_importado_em = EXCLUDED.status_sap_aux_importado_em,
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
    OR notas_convergencia_cockpit.status_sap_aux   IS DISTINCT FROM EXCLUDED.status_sap_aux
    OR notas_convergencia_cockpit.status_sap_aux_importado_em IS DISTINCT FROM EXCLUDED.status_sap_aux_importado_em
    OR notas_convergencia_cockpit.administrador_id IS DISTINCT FROM EXCLUDED.administrador_id
    OR notas_convergencia_cockpit.ordem_sap        IS DISTINCT FROM EXCLUDED.ordem_sap
    OR notas_convergencia_cockpit.tem_ordem_vinculada IS DISTINCT FROM EXCLUDED.tem_ordem_vinculada
    OR notas_convergencia_cockpit.estado_operacional  IS DISTINCT FROM EXCLUDED.estado_operacional
    OR notas_convergencia_cockpit.reason_not_eligible IS DISTINCT FROM EXCLUDED.reason_not_eligible
    OR notas_convergencia_cockpit.reason_codes        IS DISTINCT FROM EXCLUDED.reason_codes;

  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  SELECT COUNT(*) INTO v_elegiveis
  FROM public.notas_convergencia_cockpit
  WHERE eligible_cockpit = true;

  RETURN QUERY SELECT v_inseridas, v_atualizadas, v_elegiveis;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_cockpit_convergencia(UUID) IS
  'Sincroniza notas_manutencao → notas_convergencia_cockpit. '
  'Computa eligible_cockpit usando status aberto + ausência de ordem ativa, '
  'com enriquecimento opcional de status auxiliar SAP (frescor de 48h).';
