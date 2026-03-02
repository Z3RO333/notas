-- 00107_fix_views_performance_timeout.sql
--
-- Corrige timeout nas views do cockpit (Visão Geral / Copilot).
--
-- Problema: vw_iso_por_admin usava vw_ordens_notas_painel para pegar apenas
-- semaforo_atraso e status_ordem — mas essa view faz joins pesadíssimos:
--   CTE historico (nota_acompanhamentos), 2x JOIN administradores,
--   JOIN dim_centro_unidade, ARRAY(unnest). Com 15k ordens, excedia os 2min de timeout.
--
-- Fix 1: vw_iso_por_admin — ordem_agg agora consulta ordens_notas_acompanhamento
--   diretamente, calculando o semáforo inline.
--
-- Fix 2: vw_dashboard_fluxo_diario_90d — filtro de data movido para dentro
--   do conclusoes_unicas, evitando scan total de notas_historico (14k linhas).

-- ============================================================
-- 1) vw_iso_por_admin — ordem_agg sem vw_ordens_notas_painel
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
    COALESCE(c.qtd_abertas, 0)::INTEGER AS qtd_abertas
  FROM public.administradores a
  LEFT JOIN public.vw_carga_administradores c ON c.id = a.id
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
    COALESCE(avg(peso), 0)        AS nota_severity,
    COALESCE(sum(is_critico), 0)::INTEGER AS qtd_notas_criticas
  FROM nota_aging
  GROUP BY administrador_id
),
-- Substituição: query direta na tabela, sem vw_ordens_notas_painel.
-- Semáforo calculado inline com as mesmas regras da view original.
ordem_agg AS (
  SELECT
    o.administrador_id,
    count(*) FILTER (WHERE
      CASE
        WHEN o.tipo_ordem = 'PMPL'                                                      THEN false
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
    round(COALESCE(na.nota_severity, 0), 1)                                AS nota_severity,
    round(
      CASE
        WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN oa.qtd_vermelhas::NUMERIC / oa.qtd_total * 100
        ELSE 0
      END, 1)                                                               AS order_severity,
    round(
      LEAST(
        CASE
          WHEN COALESCE(ta.media, 0) > 0
            THEN ab.qtd_abertas::NUMERIC / ta.media * 100
          WHEN ab.qtd_abertas > 0 THEN 100
          ELSE 0
        END, 200), 1)                                                       AS workload_pressure,
    round(
      CASE
        WHEN ab.qtd_abertas > 0
          THEN COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas * 100
        ELSE 0
      END, 1)                                                               AS critical_density,
    COALESCE(na.qtd_notas_criticas, 0)                                     AS qtd_notas_criticas,
    COALESCE(oa.qtd_vermelhas, 0)::INTEGER                                 AS qtd_ordens_vermelhas
  FROM admin_base ab
  CROSS JOIN team_avg ta
  LEFT JOIN nota_agg na ON na.administrador_id = ab.administrador_id
  LEFT JOIN ordem_agg oa ON oa.administrador_id = ab.administrador_id
),
score AS (
  SELECT
    c.*,
    round(
      c.nota_severity * 0.25
      + c.order_severity * 0.25
      + c.workload_pressure * 0.25
      + c.critical_density * 0.25
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
  'ISO score por admin. ordem_agg usa ordens_notas_acompanhamento direto (não vw_ordens_notas_painel) '
  'para evitar joins pesados — semáforo calculado inline. Corrigido timeout em 00107.';

-- ============================================================
-- 2) vw_dashboard_fluxo_diario_90d — filtro de data antecipado
-- ============================================================
CREATE OR REPLACE VIEW public.vw_dashboard_fluxo_diario_90d AS
WITH dias AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '89 days')::DATE,
    CURRENT_DATE,
    INTERVAL '1 day'
  )::DATE AS dia
),
entradas AS (
  SELECT
    COALESCE(n.data_criacao_sap, n.created_at::DATE) AS dia,
    count(*) AS qtd_entradas
  FROM public.notas_manutencao n
  WHERE COALESCE(n.data_criacao_sap, n.created_at::DATE)
        BETWEEN (CURRENT_DATE - INTERVAL '89 days')::DATE AND CURRENT_DATE
  GROUP BY 1
),
-- Filtro de data aplicado ANTES do GROUP BY para evitar scan total de notas_historico
conclusoes_unicas AS (
  SELECT
    h.nota_id,
    min(h.created_at::DATE) AS dia
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= (CURRENT_DATE - INTERVAL '89 days')
  GROUP BY h.nota_id
),
concluidas AS (
  SELECT dia, count(*) AS qtd_concluidas
  FROM conclusoes_unicas
  WHERE dia BETWEEN (CURRENT_DATE - INTERVAL '89 days')::DATE AND CURRENT_DATE
  GROUP BY dia
)
SELECT
  d.dia,
  COALESCE(e.qtd_entradas, 0)   AS qtd_entradas,
  COALESCE(c.qtd_concluidas, 0) AS qtd_concluidas
FROM dias d
LEFT JOIN entradas   e ON e.dia = d.dia
LEFT JOIN concluidas c ON c.dia = d.dia
ORDER BY d.dia;

COMMENT ON VIEW public.vw_dashboard_fluxo_diario_90d IS
  'Fluxo diário 90d. conclusoes_unicas filtra notas_historico por data antes do GROUP BY '
  'para evitar full scan. Corrigido timeout em 00107.';
