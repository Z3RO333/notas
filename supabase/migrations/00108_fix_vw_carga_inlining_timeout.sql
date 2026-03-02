-- 00108_fix_vw_carga_inlining_timeout.sql
--
-- Problema: vw_carga_administradores é inlined pelo planner do Postgres nas views
-- vw_iso_por_admin e vw_produtividade_detalhada, gerando plano Nested Loop com 64
-- Bitmap Heap Scans separados em notas_manutencao (~21K blocos). Sob carga concorrente
-- (8-10 queries simultâneas), ultrapassa o statement_timeout=8s do role authenticated.
--
-- Fix: substituir referência a vw_carga_administradores por subquery direta de agregação
-- que força um único HashAggregate (1 scan de notas_manutencao, não 64).
--
-- Resultados após fix:
--   vw_iso_por_admin:          buffers 21385 → 2008 (10x menos), 42ms → 12ms
--   vw_produtividade_detalhada: 52ms → 23ms

-- ============================================================
-- 1) vw_iso_por_admin — admin_base sem vw_carga_administradores
-- ============================================================
CREATE OR REPLACE VIEW public.vw_iso_por_admin AS
WITH admin_base AS (
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade,
    a.max_notas,
    a.ativo,
    a.recebe_distribuicao,
    a.em_ferias,
    COALESCE(carga.qtd_abertas, 0)::INTEGER AS qtd_abertas
  FROM public.administradores a
  LEFT JOIN (
    SELECT administrador_id,
           count(*) FILTER (WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas
    FROM public.notas_manutencao
    WHERE administrador_id IS NOT NULL
    GROUP BY administrador_id
  ) carga ON carga.administrador_id = a.id
  WHERE a.role = 'admin'
),
team_avg AS (
  SELECT avg(ab.qtd_abertas) AS media
  FROM admin_base ab
  WHERE ab.ativo = true AND ab.recebe_distribuicao = true AND ab.em_ferias = false
),
nota_aging AS (
  SELECT
    n.administrador_id,
    CASE
      WHEN EXTRACT(day FROM now() - COALESCE(n.data_criacao_sap::TIMESTAMP WITH TIME ZONE, n.created_at)) >= 4 THEN 100
      WHEN EXTRACT(day FROM now() - COALESCE(n.data_criacao_sap::TIMESTAMP WITH TIME ZONE, n.created_at)) >= 3 THEN 80
      WHEN EXTRACT(day FROM now() - COALESCE(n.data_criacao_sap::TIMESTAMP WITH TIME ZONE, n.created_at)) >= 2 THEN 60
      WHEN EXTRACT(day FROM now() - COALESCE(n.data_criacao_sap::TIMESTAMP WITH TIME ZONE, n.created_at)) >= 1 THEN 30
      ELSE 0
    END AS peso,
    CASE
      WHEN EXTRACT(day FROM now() - COALESCE(n.data_criacao_sap::TIMESTAMP WITH TIME ZONE, n.created_at)) >= 3 THEN 1
      ELSE 0
    END AS is_critico
  FROM public.notas_manutencao n
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND n.administrador_id IS NOT NULL
),
nota_agg AS (
  SELECT
    administrador_id,
    COALESCE(avg(peso), 0)                AS nota_severity,
    COALESCE(sum(is_critico), 0)::INTEGER AS qtd_notas_criticas
  FROM nota_aging
  GROUP BY administrador_id
),
ordem_agg AS (
  SELECT
    o.administrador_id,
    count(*) FILTER (WHERE
      CASE
        WHEN o.tipo_ordem = 'PMPL' THEN false
        WHEN o.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO','ENVIAR_EMAIL_PFORNECEDOR')
          THEN GREATEST(CURRENT_DATE - o.data_entrada::DATE, 0) >= 21
        ELSE GREATEST(CURRENT_DATE - o.data_entrada::DATE, 0) >= 7
      END
    ) AS qtd_vermelhas,
    count(*) AS qtd_total
  FROM public.ordens_notas_acompanhamento o
  WHERE o.administrador_id IS NOT NULL
    AND o.data_entrada IS NOT NULL
    AND o.status_ordem NOT IN ('concluida', 'cancelada')
  GROUP BY o.administrador_id
),
componentes AS (
  SELECT
    ab.administrador_id,
    ab.nome,
    ab.avatar_url,
    ab.especialidade,
    ab.qtd_abertas,
    ab.max_notas,
    ab.recebe_distribuicao,
    ab.em_ferias,
    round(COALESCE(na.nota_severity, 0), 1) AS nota_severity,
    round(
      CASE
        WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN oa.qtd_vermelhas::NUMERIC / oa.qtd_total * 100
        ELSE 0
      END, 1) AS order_severity,
    round(
      LEAST(
        CASE
          WHEN COALESCE(ta.media, 0) > 0
            THEN ab.qtd_abertas::NUMERIC / ta.media * 100
          WHEN ab.qtd_abertas > 0 THEN 100
          ELSE 0
        END, 200), 1) AS workload_pressure,
    round(
      CASE
        WHEN ab.qtd_abertas > 0
          THEN COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas * 100
        ELSE 0
      END, 1) AS critical_density,
    COALESCE(na.qtd_notas_criticas, 0)      AS qtd_notas_criticas,
    COALESCE(oa.qtd_vermelhas, 0)::INTEGER  AS qtd_ordens_vermelhas
  FROM admin_base ab
  CROSS JOIN team_avg ta
  LEFT JOIN nota_agg na ON na.administrador_id = ab.administrador_id
  LEFT JOIN ordem_agg oa ON oa.administrador_id = ab.administrador_id
),
score AS (
  SELECT
    c.*,
    round(
      c.nota_severity   * 0.25
      + c.order_severity  * 0.25
      + c.workload_pressure * 0.25
      + c.critical_density  * 0.25
    , 1) AS iso_score
  FROM componentes c
)
SELECT
  administrador_id,
  nome,
  avatar_url,
  especialidade,
  nota_severity,
  order_severity,
  workload_pressure,
  critical_density,
  iso_score,
  CASE
    WHEN iso_score >= 75 THEN 'critico'
    WHEN iso_score >= 50 THEN 'risco_alto'
    WHEN iso_score >= 25 THEN 'atencao'
    ELSE 'saudavel'
  END AS iso_faixa,
  qtd_abertas,
  max_notas,
  qtd_notas_criticas,
  qtd_ordens_vermelhas
FROM score s
WHERE qtd_abertas > 0 OR recebe_distribuicao OR em_ferias
ORDER BY iso_score DESC;

COMMENT ON VIEW public.vw_iso_por_admin IS
  'ISO score por admin. admin_base usa subquery direta (HashAggregate) em vez de '
  'vw_carga_administradores para evitar Nested Loop com 64 Bitmap Heap Scans. '
  'Corrigido timeout 8s em 00108.';

-- ============================================================
-- 2) vw_produtividade_detalhada — substitui vw_carga_administradores
-- ============================================================
CREATE OR REPLACE VIEW public.vw_produtividade_detalhada AS
WITH conclusoes_unicas AS (
  SELECT
    h.nota_id,
    n.administrador_id,
    min(h.created_at) AS concluida_em
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= (now() - '60 days'::INTERVAL)
    AND n.administrador_id IS NOT NULL
  GROUP BY h.nota_id, n.administrador_id
),
agg AS (
  SELECT
    administrador_id,
    count(*) FILTER (WHERE concluida_em >= (now() - '7 days'::INTERVAL))::INTEGER  AS concluidas_7d,
    count(*) FILTER (WHERE concluida_em >= (now() - '30 days'::INTERVAL))::INTEGER AS concluidas_30d,
    count(*) FILTER (WHERE concluida_em >= (now() - '60 days'::INTERVAL)
                       AND concluida_em <  (now() - '30 days'::INTERVAL))::INTEGER AS concluidas_prev_30d
  FROM conclusoes_unicas
  GROUP BY administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COALESCE(agg.concluidas_7d, 0)       AS concluidas_7d,
  COALESCE(agg.concluidas_30d, 0)      AS concluidas_30d,
  COALESCE(agg.concluidas_prev_30d, 0) AS concluidas_prev_30d,
  round(COALESCE(agg.concluidas_30d, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  CASE
    WHEN COALESCE(agg.concluidas_prev_30d, 0) > 0
      THEN round(
        (COALESCE(agg.concluidas_30d, 0) - COALESCE(agg.concluidas_prev_30d, 0))::NUMERIC
        / agg.concluidas_prev_30d * 100, 1)
    ELSE 0
  END AS variacao_pct,
  CASE
    WHEN (COALESCE(agg.concluidas_30d, 0) + COALESCE(carga.qtd_abertas, 0)) > 0
      THEN round(
        COALESCE(agg.concluidas_30d, 0)::NUMERIC
        / (COALESCE(agg.concluidas_30d, 0) + COALESCE(carga.qtd_abertas, 0))::NUMERIC, 3)
    ELSE 0
  END AS eficiencia
FROM public.administradores a
LEFT JOIN agg ON agg.administrador_id = a.id
LEFT JOIN (
  SELECT administrador_id,
         count(*) FILTER (WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas
  FROM public.notas_manutencao
  WHERE administrador_id IS NOT NULL
  GROUP BY administrador_id
) carga ON carga.administrador_id = a.id
WHERE a.role = 'admin'
  AND (a.recebe_distribuicao OR COALESCE(agg.concluidas_30d, 0) > 0)
ORDER BY COALESCE(agg.concluidas_30d, 0) DESC;

COMMENT ON VIEW public.vw_produtividade_detalhada IS
  'Produtividade por admin. Substituído vw_carga_administradores por subquery direta '
  'para evitar Nested Loop inlining. Corrigido timeout 8s em 00108.';
