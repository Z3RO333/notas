-- 00231_fix_loja_notas_placeholder_matrix_with_order_unit.sql
--
-- Notas podem cair sem localizacao valida definida no momento da distribuicao.
-- Nesses casos, o centro da nota tende a ficar em 101 / MATRIZ e infla
-- artificialmente a agregacao "por loja (nota)".
--
-- Ajuste:
-- - mantem a unidade da nota quando ela vier definida de forma confiavel
-- - se a nota vier vazia ou cair no placeholder 101 / Loja Matriz, usa a
--   unidade detectada na primeira ordem vinculada como fallback canonico

CREATE OR REPLACE FUNCTION public.calcular_indicadores_por_loja_notas(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  unidade        TEXT,
  total_notas    INTEGER,
  total_ordens   INTEGER,
  taxa_conversao NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH notas_base AS (
    SELECT
      n.id,
      unidade_final.unidade
    FROM public.notas_manutencao n
    CROSS JOIN LATERAL (
      SELECT
        NULLIF(BTRIM(n.denominacao_unidade), '') AS denominacao_raw,
        NULLIF(BTRIM(n.centro), '')              AS centro_raw
    ) note_raw
    LEFT JOIN public.dim_centro_unidade dcu_denominacao
      ON dcu_denominacao.centro = note_raw.denominacao_raw
     AND note_raw.denominacao_raw ~ '^[0-9]+$'
    LEFT JOIN public.dim_centro_unidade dcu_centro
      ON dcu_centro.centro = note_raw.centro_raw
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        dcu_denominacao.unidade,
        note_raw.denominacao_raw,
        dcu_centro.unidade,
        note_raw.centro_raw
      ) AS unidade_raw
    ) note_unit
    LEFT JOIN public.dim_denominacao_norm note_norm
      ON note_norm.raw_nome = note_unit.unidade_raw
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(order_norm.nome_canonical, order_unit.unidade_raw) AS unidade,
        COALESCE(order_norm.inclui_gestao, TRUE)                    AS inclui_gestao
      FROM public.ordens_notas_acompanhamento ona
      CROSS JOIN LATERAL (
        SELECT
          NULLIF(BTRIM(ona.unidade), '') AS unidade_raw,
          NULLIF(BTRIM(ona.centro), '')  AS centro_raw
      ) order_raw
      LEFT JOIN public.dim_centro_unidade dcu_order_unidade
        ON dcu_order_unidade.centro = order_raw.unidade_raw
       AND order_raw.unidade_raw ~ '^[0-9]+$'
      LEFT JOIN public.dim_centro_unidade dcu_order_centro
        ON dcu_order_centro.centro = order_raw.centro_raw
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          dcu_order_unidade.unidade,
          order_raw.unidade_raw,
          dcu_order_centro.unidade,
          order_raw.centro_raw
        ) AS unidade_raw
      ) order_unit
      LEFT JOIN public.dim_denominacao_norm order_norm
        ON order_norm.raw_nome = order_unit.unidade_raw
      WHERE ona.nota_id = n.id
        AND order_unit.unidade_raw IS NOT NULL
      ORDER BY ona.ordem_detectada_em DESC NULLS LAST, ona.id DESC
      LIMIT 1
    ) order_ref ON TRUE
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN order_ref.unidade IS NOT NULL
            AND (
              note_unit.unidade_raw IS NULL
              OR note_raw.centro_raw = '101'
              OR COALESCE(note_norm.nome_canonical, note_unit.unidade_raw) = 'Loja Matriz'
            )
            THEN order_ref.unidade
          ELSE COALESCE(
            COALESCE(note_norm.nome_canonical, note_unit.unidade_raw),
            order_ref.unidade
          )
        END AS unidade,
        CASE
          WHEN order_ref.unidade IS NOT NULL
            AND (
              note_unit.unidade_raw IS NULL
              OR note_raw.centro_raw = '101'
              OR COALESCE(note_norm.nome_canonical, note_unit.unidade_raw) = 'Loja Matriz'
            )
            THEN order_ref.inclui_gestao
          ELSE COALESCE(note_norm.inclui_gestao, order_ref.inclui_gestao, TRUE)
        END AS inclui_gestao
    ) unidade_final
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
      AND unidade_final.unidade IS NOT NULL
      AND unidade_final.inclui_gestao
  ),
  agrupado AS (
    SELECT
      nb.unidade,
      COUNT(*)::INTEGER               AS total_notas,
      COUNT(DISTINCT ona.id)::INTEGER AS total_ordens
    FROM notas_base nb
    LEFT JOIN public.ordens_notas_acompanhamento ona
      ON ona.nota_id = nb.id
    GROUP BY nb.unidade
  )
  SELECT
    a.unidade,
    a.total_notas,
    a.total_ordens,
    ROUND(
      CASE
        WHEN a.total_notas = 0 THEN 0
        ELSE a.total_ordens::NUMERIC * 100.0 / a.total_notas
      END,
      1
    ) AS taxa_conversao
  FROM agrupado a
  ORDER BY a.total_notas DESC, a.unidade ASC;
$$;
