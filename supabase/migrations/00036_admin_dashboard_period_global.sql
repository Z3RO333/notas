-- 00036_admin_dashboard_period_global.sql
-- Dashboard administrativo com periodo global (notas + ordens)

CREATE INDEX IF NOT EXISTS idx_notas_manutencao_data_criacao_sap_dashboard
  ON public.notas_manutencao (data_criacao_sap)
  WHERE data_criacao_sap IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notas_historico_status_concluida_dashboard
  ON public.notas_historico (created_at DESC, nota_id)
  WHERE campo_alterado = 'status' AND valor_novo = 'concluida';

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_nota_detectada_dashboard
  ON public.ordens_notas_acompanhamento (nota_id, ordem_detectada_em DESC);

CREATE OR REPLACE FUNCTION public.calcular_metricas_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_start_iso AT TIME ZONE 'UTC')::DATE AS start_date,
      (p_end_exclusive_iso AT TIME ZONE 'UTC')::DATE AS end_date_exclusive
  ),
  notas_base AS (
    SELECT
      n.id,
      n.status,
      n.administrador_id,
      COALESCE((n.data_criacao_sap::TIMESTAMP AT TIME ZONE 'UTC'), n.created_at) AS referencia_criacao
    FROM public.notas_manutencao n
    JOIN periodo p ON TRUE
    WHERE (
        n.data_criacao_sap IS NOT NULL
        AND n.data_criacao_sap >= p.start_date
        AND n.data_criacao_sap < p.end_date_exclusive
      )
      OR (
        n.data_criacao_sap IS NULL
        AND n.created_at >= p.start_iso
        AND n.created_at < p.end_exclusive_iso
      )
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      MIN(h.created_at) AS concluida_em
    FROM public.notas_historico h
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
    GROUP BY h.nota_id
  ),
  agg_notas AS (
    SELECT
      COUNT(*)::INTEGER AS qtd_notas_criadas_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS abertas_periodo,
      COUNT(*) FILTER (
        WHERE n.status = 'nova' AND n.administrador_id IS NULL
      )::INTEGER AS sem_atribuir_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          AND now() - n.referencia_criacao > INTERVAL '48 hours'
      )::INTEGER AS aging_48h_periodo
    FROM notas_base n
  ),
  agg_convertidas AS (
    SELECT
      COUNT(DISTINCT n.id)::INTEGER AS qtd_notas_convertidas_periodo
    FROM notas_base n
    JOIN public.ordens_notas_acompanhamento o
      ON o.nota_id = n.id
    JOIN periodo p ON TRUE
    WHERE o.ordem_detectada_em < p.end_exclusive_iso
  ),
  agg_concluidas AS (
    SELECT
      COUNT(*)::INTEGER AS qtd_concluidas_periodo
    FROM conclusoes_unicas c
    JOIN periodo p ON TRUE
    WHERE c.concluida_em >= p.start_iso
      AND c.concluida_em < p.end_exclusive_iso
  )
  SELECT json_build_object(
    'abertas_periodo', a.abertas_periodo,
    'sem_atribuir_periodo', a.sem_atribuir_periodo,
    'aging_48h_periodo', a.aging_48h_periodo,
    'qtd_notas_criadas_periodo', a.qtd_notas_criadas_periodo,
    'qtd_notas_convertidas_periodo', c.qtd_notas_convertidas_periodo,
    'qtd_concluidas_periodo', f.qtd_concluidas_periodo,
    'taxa_nota_ordem_periodo',
      ROUND(
        c.qtd_notas_convertidas_periodo::NUMERIC
        / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC,
        4
      ),
    'taxa_fechamento_periodo',
      ROUND(
        f.qtd_concluidas_periodo::NUMERIC
        / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC,
        4
      )
  )
  FROM agg_notas a
  CROSS JOIN agg_convertidas c
  CROSS JOIN agg_concluidas f;
$$;

CREATE OR REPLACE FUNCTION public.listar_fluxo_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS TABLE(
  dia DATE,
  qtd_entradas INTEGER,
  qtd_concluidas INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_start_iso AT TIME ZONE 'UTC')::DATE AS start_date,
      (p_end_exclusive_iso AT TIME ZONE 'UTC')::DATE AS end_date_exclusive
  ),
  dias AS (
    SELECT
      generate_series(
        p.start_date,
        (p.end_date_exclusive - 1),
        INTERVAL '1 day'
      )::DATE AS dia
    FROM periodo p
  ),
  entradas AS (
    SELECT
      CASE
        WHEN n.data_criacao_sap IS NOT NULL THEN n.data_criacao_sap
        ELSE (n.created_at AT TIME ZONE 'UTC')::DATE
      END AS dia,
      COUNT(*)::INTEGER AS qtd_entradas
    FROM public.notas_manutencao n
    JOIN periodo p ON TRUE
    WHERE (
        n.data_criacao_sap IS NOT NULL
        AND n.data_criacao_sap >= p.start_date
        AND n.data_criacao_sap < p.end_date_exclusive
      )
      OR (
        n.data_criacao_sap IS NULL
        AND n.created_at >= p.start_iso
        AND n.created_at < p.end_exclusive_iso
      )
    GROUP BY 1
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      MIN(h.created_at::DATE) AS dia
    FROM public.notas_historico h
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
    GROUP BY h.nota_id
  ),
  concluidas AS (
    SELECT
      c.dia,
      COUNT(*)::INTEGER AS qtd_concluidas
    FROM conclusoes_unicas c
    JOIN periodo p ON TRUE
    WHERE c.dia >= p.start_date
      AND c.dia < p.end_date_exclusive
    GROUP BY c.dia
  )
  SELECT
    d.dia,
    COALESCE(e.qtd_entradas, 0)::INTEGER AS qtd_entradas,
    COALESCE(c.qtd_concluidas, 0)::INTEGER AS qtd_concluidas
  FROM dias d
  LEFT JOIN entradas e ON e.dia = d.dia
  LEFT JOIN concluidas c ON c.dia = d.dia
  ORDER BY d.dia ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_produtividade_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  avatar_url TEXT,
  especialidade TEXT,
  concluidas_periodo INTEGER,
  concluidas_periodo_anterior INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_end_exclusive_iso - p_start_iso) AS span
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      n.administrador_id,
      MIN(h.created_at) AS concluida_em
    FROM public.notas_historico h
    JOIN public.notas_manutencao n ON n.id = h.nota_id
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
      AND n.administrador_id IS NOT NULL
    GROUP BY h.nota_id, n.administrador_id
  ),
  agg AS (
    SELECT
      c.administrador_id,
      COUNT(*) FILTER (
        WHERE c.concluida_em >= p.start_iso
          AND c.concluida_em < p.end_exclusive_iso
      )::INTEGER AS concluidas_periodo,
      COUNT(*) FILTER (
        WHERE c.concluida_em >= (p.start_iso - p.span)
          AND c.concluida_em < p.start_iso
      )::INTEGER AS concluidas_periodo_anterior
    FROM conclusoes_unicas c
    CROSS JOIN periodo p
    GROUP BY c.administrador_id
  )
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade::TEXT AS especialidade,
    COALESCE(agg.concluidas_periodo, 0)::INTEGER AS concluidas_periodo,
    COALESCE(agg.concluidas_periodo_anterior, 0)::INTEGER AS concluidas_periodo_anterior
  FROM public.administradores a
  LEFT JOIN agg ON agg.administrador_id = a.id
  WHERE a.role = 'admin'
  ORDER BY concluidas_periodo DESC, a.nome ASC;
$$;

CREATE OR REPLACE FUNCTION public.buscar_ordens_prioritarias_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  WHERE v.ordem_detectada_em >= p_start_iso
    AND v.ordem_detectada_em < p_end_exclusive_iso
  ORDER BY
    CASE v.semaforo_atraso
      WHEN 'vermelho' THEN 3
      WHEN 'amarelo' THEN 2
      WHEN 'verde' THEN 1
      ELSE 0
    END DESC,
    CASE
      WHEN v.status_ordem IN ('concluida', 'cancelada') THEN 0
      ELSE 1
    END DESC,
    v.ordem_detectada_em DESC,
    v.ordem_codigo ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 1000);
$$;
