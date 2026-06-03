-- 00269_financeiro_aggregates_and_workspace_units.sql
--
-- Performance:
-- - Evita que /admin/financeiro baixe todas as linhas de vw_financeiro_ordens
--   e cartao_corporativo_gastos para agregar no Next.js.
-- - Evita que /api/ordens/workspace derive opcoes de unidade carregando linhas
--   completas do workspace.

CREATE INDEX IF NOT EXISTS idx_financeiro_ordens_competencia_tipo_expr
  ON public.ordens_financeiro_importado (
    tipo_ordem,
    (EXTRACT(YEAR FROM (
      CASE
        WHEN tipo_ordem = 'PMPL' THEN COALESCE(inicio_programado, data_entrada)
        ELSE data_entrada
      END
    ))::INTEGER),
    (EXTRACT(MONTH FROM (
      CASE
        WHEN tipo_ordem = 'PMPL' THEN COALESCE(inicio_programado, data_entrada)
        ELSE data_entrada
      END
    ))::INTEGER)
  );

CREATE INDEX IF NOT EXISTS idx_cartao_corporativo_gastos_ano_mes_fornecedor
  ON public.cartao_corporativo_gastos (ano, mes, fornecedor);

CREATE INDEX IF NOT EXISTS idx_cartao_corporativo_gastos_ano_mes_centro
  ON public.cartao_corporativo_gastos (ano, mes, centro_custo);

CREATE OR REPLACE FUNCTION public.buscar_financeiro_dashboard_agregado(
  p_ano INTEGER DEFAULT NULL,
  p_mes INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tipos AS (
    SELECT UNNEST(ARRAY['PMOS', 'PMPL'])::TEXT AS tipo_ordem
  ),
  base AS MATERIALIZED (
    SELECT
      v.tipo_ordem,
      v.competencia_ano AS ano,
      v.competencia_mes AS mes,
      COALESCE(NULLIF(BTRIM(v.denominacao_unidade), ''), 'Sem unidade') AS unidade,
      COALESCE(NULLIF(BTRIM(v.texto_breve), ''), 'Sem servico') AS servico,
      COALESCE(NULLIF(BTRIM(v.fornecedor_nome), ''), NULLIF(BTRIM(v.fornecedor_codigo), ''), 'Sem fornecedor') AS fornecedor,
      GREATEST(COALESCE(v.valor_realizado, 0)::NUMERIC, 0::NUMERIC) AS realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::NUMERIC, 0::NUMERIC) AS previsto_pendente,
      COALESCE(v.tem_custo_real, FALSE) AS tem_custo_real
    FROM public.vw_financeiro_ordens v
    WHERE v.tipo_ordem IN ('PMOS', 'PMPL')
      AND (p_ano IS NULL OR v.competencia_ano = p_ano)
      AND (p_mes IS NULL OR v.competencia_mes = p_mes)
  ),
  summaries AS (
    SELECT
      t.tipo_ordem,
      COUNT(b.*)::INTEGER AS total_ordens,
      COUNT(*) FILTER (WHERE b.tem_custo_real)::INTEGER AS ordens_com_custo_real,
      COALESCE(SUM(b.realizado), 0)::NUMERIC AS custo_realizado,
      COALESCE(SUM(b.previsto_pendente), 0)::NUMERIC AS custo_previsto_pendente
    FROM tipos t
    LEFT JOIN base b
      ON b.tipo_ordem = t.tipo_ordem
    GROUP BY t.tipo_ordem
  ),
  evolucao AS (
    SELECT
      b.tipo_ordem,
      b.ano,
      b.mes,
      SUM(b.realizado)::NUMERIC AS realizado,
      SUM(b.previsto_pendente)::NUMERIC AS previsto_pendente
    FROM base b
    WHERE b.ano IS NOT NULL
      AND b.mes IS NOT NULL
    GROUP BY b.tipo_ordem, b.ano, b.mes
  ),
  unidades AS (
    SELECT *
    FROM (
      SELECT
        b.tipo_ordem,
        b.unidade AS nome,
        SUM(b.realizado)::NUMERIC AS realizado,
        SUM(b.previsto_pendente)::NUMERIC AS previsto_pendente,
        ROW_NUMBER() OVER (PARTITION BY b.tipo_ordem ORDER BY SUM(b.realizado) DESC, b.unidade ASC) AS rn
      FROM base b
      GROUP BY b.tipo_ordem, b.unidade
    ) ranked
    WHERE rn <= 10
  ),
  servicos AS (
    SELECT *
    FROM (
      SELECT
        b.tipo_ordem,
        b.servico AS nome,
        SUM(b.realizado)::NUMERIC AS realizado,
        SUM(b.previsto_pendente)::NUMERIC AS previsto_pendente,
        ROW_NUMBER() OVER (PARTITION BY b.tipo_ordem ORDER BY SUM(b.realizado) DESC, b.servico ASC) AS rn
      FROM base b
      GROUP BY b.tipo_ordem, b.servico
    ) ranked
    WHERE rn <= 12
  ),
  fornecedores AS (
    SELECT *
    FROM (
      SELECT
        b.tipo_ordem,
        b.fornecedor AS nome,
        SUM(b.realizado)::NUMERIC AS realizado,
        SUM(b.previsto_pendente)::NUMERIC AS previsto_pendente,
        ROW_NUMBER() OVER (PARTITION BY b.tipo_ordem ORDER BY SUM(b.realizado) DESC, b.fornecedor ASC) AS rn
      FROM base b
      GROUP BY b.tipo_ordem, b.fornecedor
    ) ranked
    WHERE rn <= 12
  ),
  years AS (
    SELECT DISTINCT competencia_ano AS ano
    FROM public.vw_financeiro_ordens
    WHERE competencia_ano IS NOT NULL
  )
  SELECT jsonb_build_object(
    'yearOptions', COALESCE((SELECT jsonb_agg(y.ano ORDER BY y.ano DESC) FROM years y), '[]'::JSONB),
    'tipos', COALESCE((
      SELECT jsonb_object_agg(
        s.tipo_ordem,
        jsonb_build_object(
          'summary', jsonb_build_object(
            'tipo_ordem', s.tipo_ordem,
            'total_ordens', s.total_ordens,
            'ordens_com_custo_real', s.ordens_com_custo_real,
            'custo_realizado', s.custo_realizado,
            'custo_previsto_pendente', s.custo_previsto_pendente,
            'ticket_medio_realizado', CASE WHEN s.ordens_com_custo_real > 0 THEN s.custo_realizado / s.ordens_com_custo_real ELSE 0 END,
            'cobertura_percentual', CASE WHEN s.total_ordens > 0 THEN (s.ordens_com_custo_real::NUMERIC / s.total_ordens) * 100 ELSE 0 END
          ),
          'evolucao', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'ano', e.ano,
                'mes', e.mes,
                'realizado', e.realizado,
                'previsto_pendente', e.previsto_pendente,
                'total_gasto', e.realizado,
                'compromisso_total', e.realizado + e.previsto_pendente
              )
              ORDER BY e.ano, e.mes
            )
            FROM evolucao e
            WHERE e.tipo_ordem = s.tipo_ordem
          ), '[]'::JSONB),
          'unidades', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'nome', u.nome,
                'realizado', u.realizado,
                'previsto_pendente', u.previsto_pendente,
                'total_gasto', u.realizado,
                'compromisso_total', u.realizado + u.previsto_pendente
              )
              ORDER BY u.realizado DESC, u.nome ASC
            )
            FROM unidades u
            WHERE u.tipo_ordem = s.tipo_ordem
          ), '[]'::JSONB),
          'servicos', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'nome', se.nome,
                'realizado', se.realizado,
                'previsto_pendente', se.previsto_pendente,
                'total_gasto', se.realizado,
                'compromisso_total', se.realizado + se.previsto_pendente
              )
              ORDER BY se.realizado DESC, se.nome ASC
            )
            FROM servicos se
            WHERE se.tipo_ordem = s.tipo_ordem
          ), '[]'::JSONB),
          'fornecedores', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'nome', f.nome,
                'realizado', f.realizado,
                'previsto_pendente', f.previsto_pendente,
                'total_gasto', f.realizado,
                'compromisso_total', f.realizado + f.previsto_pendente
              )
              ORDER BY f.realizado DESC, f.nome ASC
            )
            FROM fornecedores f
            WHERE f.tipo_ordem = s.tipo_ordem
          ), '[]'::JSONB)
        )
      )
      FROM summaries s
    ), '{}'::JSONB)
  );
$$;

CREATE OR REPLACE FUNCTION public.buscar_cartao_dashboard_agregado(
  p_ano INTEGER DEFAULT NULL,
  p_mes INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS MATERIALIZED (
    SELECT
      c.ano,
      c.mes,
      COALESCE(NULLIF(BTRIM(c.fornecedor), ''), 'Sem fornecedor') AS fornecedor,
      COALESCE(NULLIF(BTRIM(c.centro_custo), ''), 'Sem centro') AS centro,
      GREATEST(COALESCE(c.valor, 0)::NUMERIC, 0::NUMERIC) AS valor
    FROM public.cartao_corporativo_gastos c
    WHERE (p_ano IS NULL OR c.ano = p_ano)
      AND (p_mes IS NULL OR c.mes = p_mes)
  ),
  mensal AS (
    SELECT ano, mes, SUM(valor)::NUMERIC AS total, COUNT(*)::INTEGER AS qtd
    FROM base
    GROUP BY ano, mes
  ),
  fornecedores AS (
    SELECT fornecedor AS nome, SUM(valor)::NUMERIC AS total, COUNT(*)::INTEGER AS qtd
    FROM base
    GROUP BY fornecedor
    ORDER BY total DESC, fornecedor ASC
    LIMIT 10
  ),
  centros AS (
    SELECT centro AS nome, SUM(valor)::NUMERIC AS total, COUNT(*)::INTEGER AS qtd
    FROM base
    GROUP BY centro
    ORDER BY total DESC, centro ASC
    LIMIT 10
  ),
  years AS (
    SELECT DISTINCT ano
    FROM public.cartao_corporativo_gastos
    WHERE ano IS NOT NULL
  )
  SELECT jsonb_build_object(
    'yearOptions', COALESCE((SELECT jsonb_agg(y.ano ORDER BY y.ano DESC) FROM years y), '[]'::JSONB),
    'kpi', jsonb_build_object(
      'total_gasto', COALESCE((SELECT SUM(valor) FROM base), 0),
      'qtd_transacoes', COALESCE((SELECT COUNT(*) FROM base), 0),
      'ticket_medio', CASE WHEN COALESCE((SELECT COUNT(*) FROM base), 0) > 0 THEN COALESCE((SELECT SUM(valor) FROM base), 0) / (SELECT COUNT(*) FROM base) ELSE 0 END
    ),
    'mensal', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('ano', m.ano, 'mes', m.mes, 'total', m.total, 'qtd', m.qtd)
        ORDER BY m.ano, m.mes
      )
      FROM mensal m
    ), '[]'::JSONB),
    'fornecedores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', f.nome, 'total', f.total, 'qtd', f.qtd) ORDER BY f.total DESC, f.nome ASC)
      FROM fornecedores f
    ), '[]'::JSONB),
    'centros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', c.nome, 'total', c.total, 'qtd', c.qtd) ORDER BY c.total DESC, c.nome ASC)
      FROM centros c
    ), '[]'::JSONB)
  );
$$;

CREATE OR REPLACE FUNCTION public.listar_ordens_workspace_unidades(
  p_period_mode       TEXT                     DEFAULT 'all',
  p_year              INTEGER                  DEFAULT NULL,
  p_month             INTEGER                  DEFAULT NULL,
  p_start_iso         TIMESTAMPTZ              DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ              DEFAULT NULL,
  p_status            TEXT                     DEFAULT NULL,
  p_responsavel       TEXT                     DEFAULT NULL,
  p_prioridade        TEXT                     DEFAULT NULL,
  p_admin_scope       UUID                     DEFAULT NULL,
  p_tipo_ordem        TEXT                     DEFAULT NULL
)
RETURNS TABLE(unidade TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT v.unidade
  FROM public.filtrar_ordens_workspace(
    p_period_mode,
    p_year,
    p_month,
    p_start_iso,
    p_end_exclusive_iso,
    p_status,
    NULL,
    p_responsavel,
    p_prioridade,
    NULL,
    p_admin_scope,
    p_tipo_ordem
  ) v
  WHERE NULLIF(BTRIM(v.unidade), '') IS NOT NULL
  ORDER BY v.unidade;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_financeiro_dashboard_agregado(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_cartao_dashboard_agregado(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_ordens_workspace_unidades(TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
