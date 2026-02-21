-- 00053_orders_manutencao_referencia.sql
-- Nova referência de ordens de manutenção e enriquecimento direto em
-- ordens_notas_acompanhamento.
--
-- Decisão operacional neste pacote:
-- - Não altera vw_ordens_notas_painel (reduz risco de regressão global).
-- - Enriquecimento é aplicado na tabela operacional.
-- - numero_nota só é preenchida quando ausente e existir em notas_manutencao.

CREATE TABLE IF NOT EXISTS public.ordens_manutencao_referencia (
  ordem_codigo_norm TEXT PRIMARY KEY,
  ordem_codigo_original TEXT NOT NULL,
  numero_nota_norm TEXT,
  numero_nota_original TEXT,
  tipo_ordem TEXT CHECK (tipo_ordem IN ('PMOS', 'PMPL')),
  texto_breve TEXT,
  centro_liberacao TEXT,
  data_extracao TIMESTAMPTZ,
  fonte TEXT NOT NULL DEFAULT 'manutencao.silver.selecao_ordens_manutencao',
  last_sync_id UUID REFERENCES public.sync_log(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ordens_manutencao_referencia IS
  'Referência de ordens da fonte selecao_ordens_manutencao para enriquecer tipo_ordem, centro, nota e texto_breve.';

COMMENT ON COLUMN public.ordens_manutencao_referencia.ordem_codigo_norm IS
  'ORDEM normalizada (remove zeros à esquerda para chaves numéricas).';

COMMENT ON COLUMN public.ordens_manutencao_referencia.numero_nota_norm IS
  'NOTA normalizada (remove zeros à esquerda para chaves numéricas).';

CREATE INDEX IF NOT EXISTS idx_ordens_manut_ref_tipo
  ON public.ordens_manutencao_referencia (tipo_ordem);

CREATE INDEX IF NOT EXISTS idx_ordens_manut_ref_updated
  ON public.ordens_manutencao_referencia (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_manut_ref_data_extracao
  ON public.ordens_manutencao_referencia (data_extracao DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_ordens_manut_ref_updated'
  ) THEN
    CREATE TRIGGER trg_ordens_manut_ref_updated
      BEFORE UPDATE ON public.ordens_manutencao_referencia
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.ordens_manutencao_referencia DISABLE ROW LEVEL SECURITY;

-- Estado operacional para controlar streak de falhas por job.
CREATE TABLE IF NOT EXISTS public.sync_job_runtime_state (
  job_name TEXT PRIMARY KEY,
  orders_ref_v2_failure_streak INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_job_runtime_state_updated
  ON public.sync_job_runtime_state (updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_sync_job_runtime_state_updated'
  ) THEN
    CREATE TRIGGER trg_sync_job_runtime_state_updated
      BEFORE UPDATE ON public.sync_job_runtime_state
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.sync_job_runtime_state DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enriquecer_ordens_por_referencia_manutencao()
RETURNS TABLE(
  ordens_atualizadas_total INTEGER,
  tipo_ordem_atualizadas INTEGER,
  centro_preenchidos INTEGER,
  numero_nota_preenchidas INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH ref AS (
    SELECT
      r.ordem_codigo_norm,
      NULLIF(BTRIM(r.tipo_ordem), '') AS tipo_ordem_ref,
      NULLIF(BTRIM(r.centro_liberacao), '') AS centro_liberacao_ref,
      NULLIF(BTRIM(r.numero_nota_norm), '') AS numero_nota_ref
    FROM public.ordens_manutencao_referencia r
  ),
  candidatos AS (
    SELECT
      o.id,
      o.tipo_ordem AS tipo_ordem_old,
      o.centro AS centro_old,
      o.numero_nota AS numero_nota_old,
      CASE
        WHEN ref.tipo_ordem_ref IS NOT NULL THEN ref.tipo_ordem_ref
        ELSE o.tipo_ordem
      END AS tipo_ordem_new,
      CASE
        WHEN o.centro IS NULL OR BTRIM(o.centro) = '' THEN ref.centro_liberacao_ref
        ELSE o.centro
      END AS centro_new,
      CASE
        WHEN (o.numero_nota IS NULL OR BTRIM(o.numero_nota) = '')
          AND ref.numero_nota_ref IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.notas_manutencao n
            WHERE n.numero_nota = ref.numero_nota_ref
          )
        THEN ref.numero_nota_ref
        ELSE o.numero_nota
      END AS numero_nota_new
    FROM public.ordens_notas_acompanhamento o
    JOIN ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
  ),
  delta AS (
    SELECT
      c.id,
      c.tipo_ordem_new,
      c.centro_new,
      c.numero_nota_new,
      (c.tipo_ordem_new IS DISTINCT FROM c.tipo_ordem_old) AS tipo_ordem_changed,
      (c.centro_new IS DISTINCT FROM c.centro_old) AS centro_changed,
      (c.numero_nota_new IS DISTINCT FROM c.numero_nota_old) AS numero_nota_changed
    FROM candidatos c
    WHERE c.tipo_ordem_new IS DISTINCT FROM c.tipo_ordem_old
       OR c.centro_new IS DISTINCT FROM c.centro_old
       OR c.numero_nota_new IS DISTINCT FROM c.numero_nota_old
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      tipo_ordem = d.tipo_ordem_new,
      centro = d.centro_new,
      numero_nota = d.numero_nota_new,
      unidade = CASE
        WHEN d.centro_new IS NULL OR BTRIM(d.centro_new) = '' THEN o.unidade
        ELSE COALESCE(du.unidade, o.unidade)
      END,
      updated_at = now()
    FROM delta d
    LEFT JOIN public.dim_centro_unidade du
      ON du.centro = d.centro_new
    WHERE o.id = d.id
    RETURNING
      d.tipo_ordem_changed,
      d.centro_changed,
      d.numero_nota_changed
  )
  SELECT
    COUNT(*)::INTEGER AS ordens_atualizadas_total,
    COALESCE(SUM(CASE WHEN u.tipo_ordem_changed THEN 1 ELSE 0 END), 0)::INTEGER AS tipo_ordem_atualizadas,
    COALESCE(SUM(CASE WHEN u.centro_changed THEN 1 ELSE 0 END), 0)::INTEGER AS centro_preenchidos,
    COALESCE(SUM(CASE WHEN u.numero_nota_changed THEN 1 ELSE 0 END), 0)::INTEGER AS numero_nota_preenchidas
  FROM upd u;
END;
$$;

COMMENT ON FUNCTION public.enriquecer_ordens_por_referencia_manutencao() IS
  'Enriquece ordens_notas_acompanhamento por ordens_manutencao_referencia. '
  'Preenche numero_nota somente quando ausente e nota existente em notas_manutencao.';
