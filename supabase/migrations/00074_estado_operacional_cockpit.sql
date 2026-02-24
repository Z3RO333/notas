-- 00074_estado_operacional_cockpit.sql
-- Introduz estado operacional da nota na convergência do cockpit.
-- Mantém compatibilidade com eligible_cockpit e views atuais.

-- ============================================================
-- 1) Enum de estado operacional do cockpit (domínio de notas)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cockpit_estado_operacional'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.cockpit_estado_operacional AS ENUM (
      'COCKPIT_PENDENTE',
      'AGUARDANDO_CONVERGENCIA',
      'COM_ORDEM',
      'ENCERRADA_SEM_ORDEM',
      'CANCELADA'
    );
  END IF;
END;
$$;

-- ============================================================
-- 2) Coluna + backfill inicial
-- ============================================================
ALTER TABLE public.notas_convergencia_cockpit
  ADD COLUMN IF NOT EXISTS estado_operacional public.cockpit_estado_operacional
  NOT NULL DEFAULT 'AGUARDANDO_CONVERGENCIA';

UPDATE public.notas_convergencia_cockpit
SET estado_operacional = CASE
  WHEN tem_ordem_vinculada THEN 'COM_ORDEM'::public.cockpit_estado_operacional
  WHEN status = 'cancelada' THEN 'CANCELADA'::public.cockpit_estado_operacional
  WHEN status = 'concluida' THEN 'ENCERRADA_SEM_ORDEM'::public.cockpit_estado_operacional
  WHEN eligible_cockpit THEN 'COCKPIT_PENDENTE'::public.cockpit_estado_operacional
  ELSE 'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional
END
WHERE estado_operacional = 'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional;

CREATE INDEX IF NOT EXISTS idx_notas_estado_operacional
  ON public.notas_convergencia_cockpit (estado_operacional);

CREATE INDEX IF NOT EXISTS idx_notas_admin_estado
  ON public.notas_convergencia_cockpit (administrador_id, estado_operacional);

-- ============================================================
-- 3) View do cockpit (compatível: segue filtrando eligible=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_cockpit_convergidas AS
SELECT
  c.nota_id AS id,
  c.numero_nota,
  c.numero_nota_norm,
  c.nota_id,
  c.ordem_sap,
  c.ordem_gerada,
  c.ordem_candidata,
  c.ordem_candidata_norm,
  c.status,
  c.estado_operacional,
  c.descricao,
  c.centro,
  c.administrador_id,
  c.data_criacao_sap,
  c.tem_qmel,
  c.tem_pmpl,
  c.tem_mestre,
  c.status_elegivel,
  c.tem_ordem_vinculada,
  c.eligible_cockpit,
  c.reason_not_eligible,
  c.reason_codes,
  c.sync_id,
  c.source_updated_at,
  c.created_at,
  c.updated_at
FROM public.notas_convergencia_cockpit c
WHERE c.eligible_cockpit = true
ORDER BY c.data_criacao_sap ASC NULLS LAST, c.updated_at ASC;

-- ============================================================
-- 4) View de ordens sem nota (domínio de ordens)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_ordens_sem_nota_operacional AS
SELECT
  o.id AS ordem_id,
  o.ordem_codigo,
  o.numero_nota,
  o.administrador_id,
  a.nome AS administrador_nome,
  o.centro,
  COALESCE(o.unidade, d.unidade) AS unidade,
  o.status_ordem,
  o.status_ordem_raw,
  o.ordem_detectada_em,
  o.status_atualizado_em,
  'ORDEM_SEM_NOTA'::TEXT AS estado_operacional,
  o.created_at,
  o.updated_at
FROM public.ordens_notas_acompanhamento o
LEFT JOIN public.administradores a
  ON a.id = o.administrador_id
LEFT JOIN public.dim_centro_unidade d
  ON d.centro = o.centro
WHERE o.nota_id IS NULL;

