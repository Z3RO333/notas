-- 00152_graficos_pmpl_direto.sql
--
-- Root cause: vw_dashboard_gestao_manutencao e calcular_gestao_top_lojas_por_status
-- usam JOIN notas_manutencao → ordens_notas_acompanhamento ON nota_id.
-- Para ordens PMPL, nota_id é NULL, portanto PMPL fica quase totalmente ausente
-- dos gráficos (só aparece os poucos com nota_id preenchido).
--
-- Fix: UNION ALL com path direto para PMPL (ona + ordens_financeiro_importado)
-- usando inicio_programado como data de competência (não data_entrada).

-- ---------------------------------------------------------------------------
-- vw_dashboard_gestao_manutencao
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.vw_dashboard_gestao_manutencao;

CREATE VIEW public.vw_dashboard_gestao_manutencao AS
-- PMOS: path via notas_manutencao (nota_id não é NULL)
SELECT
  COALESCE(
    norm.nome_canonical,
    NULLIF(BTRIM(ona.denominacao_unidade), ''),
    ona.unidade
  )                                                                             AS nome_loja,
  n.centro,
  n.descricao                                                                   AS texto_breve,
  ona.tipo_ordem,
  COALESCE(
    norm.tipo_unidade_override,
    CASE
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
        THEN 'CD'
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
        THEN 'FARMA'
      WHEN ona.unidade IS NOT NULL THEN 'LOJA'
      ELSE NULL
    END
  )                                                                             AS tipo_unidade,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int   AS ano,
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int   AS mes,
  COUNT(DISTINCT ona.id)                                                        AS total_ordens,
  COUNT(DISTINCT n.id)                                                          AS total_notas
FROM public.notas_manutencao n
LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
LEFT JOIN public.dim_denominacao_norm norm
  ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
WHERE n.descricao <> ''
GROUP BY
  COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade),
  norm.tipo_unidade_override,
  ona.unidade,
  n.centro,
  n.descricao,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date)),
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))

UNION ALL

-- PMPL direto: nota_id é NULL, usa financeiro para texto_breve e inicio_programado para competência
SELECT
  COALESCE(
    norm.nome_canonical,
    NULLIF(BTRIM(ona.denominacao_unidade), ''),
    ona.unidade
  )                                                                             AS nome_loja,
  NULL::text                                                                    AS centro,
  f.texto_breve                                                                 AS texto_breve,
  'PMPL'::text                                                                  AS tipo_ordem,
  COALESCE(
    norm.tipo_unidade_override,
    CASE
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
        THEN 'CD'
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
        THEN 'FARMA'
      WHEN ona.unidade IS NOT NULL THEN 'LOJA'
      ELSE NULL
    END
  )                                                                             AS tipo_unidade,
  EXTRACT(YEAR  FROM f.inicio_programado)::int                                  AS ano,
  EXTRACT(MONTH FROM f.inicio_programado)::int                                  AS mes,
  COUNT(DISTINCT ona.id)                                                        AS total_ordens,
  0                                                                             AS total_notas
FROM public.ordens_notas_acompanhamento ona
JOIN public.ordens_financeiro_importado f
  ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
LEFT JOIN public.dim_denominacao_norm norm
  ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
WHERE ona.tipo_ordem = 'PMPL'
  AND ona.nota_id IS NULL
  AND f.inicio_programado IS NOT NULL
  AND BTRIM(COALESCE(f.texto_breve, '')) <> ''
GROUP BY
  COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade),
  norm.tipo_unidade_override,
  ona.unidade,
  f.texto_breve,
  EXTRACT(YEAR  FROM f.inicio_programado),
  EXTRACT(MONTH FROM f.inicio_programado);

ALTER VIEW public.vw_dashboard_gestao_manutencao SET (security_invoker = on);

COMMENT ON VIEW public.vw_dashboard_gestao_manutencao IS
  'Visão para gráficos de gestão. PMOS via notas_manutencao; PMPL direto via ordens_financeiro_importado usando inicio_programado como competência.';

-- ---------------------------------------------------------------------------
-- calcular_gestao_top_lojas_por_status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_gestao_top_lojas_por_status(
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL,
  p_tipo_ordem TEXT    DEFAULT NULL
)
RETURNS TABLE(
  nome_loja    TEXT,
  tipo_unidade TEXT,
  concluidas   INTEGER,
  em_aberto    INTEGER,
  total_ordens INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH pmos_base AS (
    -- PMOS: path via notas_manutencao (nota_id não é NULL)
    SELECT
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.notas_manutencao n
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE
      BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(p_tipo_ordem))
      -- Exclui PMPL do path PMOS quando filtro é explicitamente PMPL
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) <> 'PMPL')
  ),
  pmpl_base AS (
    -- PMPL direto: nota_id é NULL, usa inicio_programado como competência
    SELECT
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE
      ona.tipo_ordem = 'PMPL'
      AND ona.nota_id IS NULL
      AND f.inicio_programado IS NOT NULL
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR EXTRACT(YEAR  FROM f.inicio_programado)::int = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM f.inicio_programado)::int = p_mes)
      -- Inclui PMPL path só quando filtro é NULL ou 'PMPL'
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) = 'PMPL')
  ),
  base AS (
    SELECT * FROM pmos_base
    UNION ALL
    SELECT * FROM pmpl_base
  )
  SELECT
    b.nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto,
    COUNT(*)::INTEGER                                                       AS total_ordens
  FROM base b
  WHERE
    b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;
