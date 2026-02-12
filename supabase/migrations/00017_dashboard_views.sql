-- 00017_dashboard_views.sql
-- Views de suporte ao dashboard hibrido (executivo + operacional)

-- Fluxo diario (entradas x concluidas) com janela rolante de 90 dias
CREATE OR REPLACE VIEW public.vw_dashboard_fluxo_diario_90d AS
WITH dias AS (
  SELECT
    generate_series(
      (current_date - INTERVAL '89 days')::date,
      current_date::date,
      INTERVAL '1 day'
    )::date AS dia
),
entradas AS (
  SELECT
    COALESCE(n.data_criacao_sap, n.created_at::date) AS dia,
    COUNT(*)::bigint AS qtd_entradas
  FROM public.notas_manutencao n
  WHERE COALESCE(n.data_criacao_sap, n.created_at::date)
    BETWEEN (current_date - INTERVAL '89 days')::date AND current_date::date
  GROUP BY 1
),
concluidas AS (
  SELECT
    h.created_at::date AS dia,
    COUNT(*)::bigint AS qtd_concluidas
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at::date
      BETWEEN (current_date - INTERVAL '89 days')::date AND current_date::date
  GROUP BY 1
)
SELECT
  d.dia,
  COALESCE(e.qtd_entradas, 0)::bigint AS qtd_entradas,
  COALESCE(c.qtd_concluidas, 0)::bigint AS qtd_concluidas
FROM dias d
LEFT JOIN entradas e ON e.dia = d.dia
LEFT JOIN concluidas c ON c.dia = d.dia
ORDER BY d.dia;

-- Produtividade individual comparando ultimos 30 dias com os 30 dias anteriores
CREATE OR REPLACE VIEW public.vw_dashboard_produtividade_60d AS
WITH periodo AS (
  SELECT
    (current_date - INTERVAL '29 days')::date AS inicio_atual,
    current_date::date AS fim_atual,
    (current_date - INTERVAL '59 days')::date AS inicio_anterior,
    (current_date - INTERVAL '30 days')::date AS fim_anterior
),
conclusoes AS (
  SELECT
    n.administrador_id,
    h.created_at::date AS dia
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at::date BETWEEN (current_date - INTERVAL '59 days')::date AND current_date::date
    AND n.administrador_id IS NOT NULL
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COUNT(*) FILTER (
    WHERE c.dia BETWEEN p.inicio_atual AND p.fim_atual
  )::bigint AS concluidas_30d,
  COUNT(*) FILTER (
    WHERE c.dia BETWEEN p.inicio_anterior AND p.fim_anterior
  )::bigint AS concluidas_prev_30d
FROM public.administradores a
CROSS JOIN periodo p
LEFT JOIN conclusoes c ON c.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY
  a.id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  p.inicio_atual,
  p.fim_atual,
  p.inicio_anterior,
  p.fim_anterior;
