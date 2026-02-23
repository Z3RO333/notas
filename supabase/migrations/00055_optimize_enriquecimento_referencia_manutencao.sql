-- 00055_optimize_enriquecimento_referencia_manutencao.sql
-- Otimiza a RPC de enriquecimento v2 para reduzir risco de statement timeout.
-- Estratégia:
-- 1) Pré-filtra somente ordens com chance real de mudança.
-- 2) Resolve validação de numero_nota em lote (evita EXISTS por linha).

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
  pre_candidatos AS (
    SELECT
      o.id,
      o.tipo_ordem AS tipo_ordem_old,
      o.centro AS centro_old,
      o.numero_nota AS numero_nota_old,
      ref.tipo_ordem_ref,
      ref.centro_liberacao_ref,
      ref.numero_nota_ref
    FROM public.ordens_notas_acompanhamento o
    JOIN ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    WHERE
      (
        ref.tipo_ordem_ref IS NOT NULL
        AND ref.tipo_ordem_ref IS DISTINCT FROM o.tipo_ordem
      )
      OR (
        (o.centro IS NULL OR BTRIM(o.centro) = '')
        AND ref.centro_liberacao_ref IS NOT NULL
      )
      OR (
        (o.numero_nota IS NULL OR BTRIM(o.numero_nota) = '')
        AND ref.numero_nota_ref IS NOT NULL
      )
  ),
  notas_referencia AS (
    SELECT DISTINCT p.numero_nota_ref AS numero_nota
    FROM pre_candidatos p
    WHERE p.numero_nota_ref IS NOT NULL
  ),
  notas_existentes AS (
    SELECT n.numero_nota
    FROM public.notas_manutencao n
    JOIN notas_referencia nr
      ON nr.numero_nota = n.numero_nota
  ),
  candidatos AS (
    SELECT
      p.id,
      p.tipo_ordem_old,
      p.centro_old,
      p.numero_nota_old,
      CASE
        WHEN p.tipo_ordem_ref IS NOT NULL THEN p.tipo_ordem_ref
        ELSE p.tipo_ordem_old
      END AS tipo_ordem_new,
      CASE
        WHEN p.centro_old IS NULL OR BTRIM(p.centro_old) = '' THEN p.centro_liberacao_ref
        ELSE p.centro_old
      END AS centro_new,
      CASE
        WHEN (p.numero_nota_old IS NULL OR BTRIM(p.numero_nota_old) = '')
          AND p.numero_nota_ref IS NOT NULL
          AND ne.numero_nota IS NOT NULL
        THEN p.numero_nota_ref
        ELSE p.numero_nota_old
      END AS numero_nota_new
    FROM pre_candidatos p
    LEFT JOIN notas_existentes ne
      ON ne.numero_nota = p.numero_nota_ref
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
  'Enriquece ordens_notas_acompanhamento por ordens_manutencao_referencia com pré-filtro de candidatos e validação de nota em lote.';
