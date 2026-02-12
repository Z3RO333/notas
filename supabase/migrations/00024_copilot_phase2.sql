-- =============================================
-- MIGRATION 00023: Copilot Phase 2 — Radar e Produtividade
-- Views para workload radar e produtividade detalhada
-- =============================================

-- View: Radar de carga do colaborador
-- Junta ISO, carga, notas criticas, ordens vermelhas, produtividade recente
CREATE OR REPLACE VIEW public.vw_radar_colaborador AS
WITH concluidas_recentes AS (
  SELECT
    h.nota_id,
    n.administrador_id,
    h.created_at
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= NOW() - INTERVAL '30 days'
),
concluidas_7d AS (
  SELECT
    administrador_id,
    COUNT(*)::INT AS qtd
  FROM concluidas_recentes
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
),
concluidas_30d AS (
  SELECT
    administrador_id,
    COUNT(*)::INT AS qtd
  FROM concluidas_recentes
  GROUP BY administrador_id
)
SELECT
  iso.administrador_id,
  iso.nome,
  iso.avatar_url,
  iso.especialidade,
  iso.iso_score,
  iso.iso_faixa,
  iso.qtd_abertas,
  iso.max_notas,
  iso.workload_pressure AS pct_carga,
  CASE
    WHEN iso.max_notas > 0 AND (iso.qtd_abertas::NUMERIC / iso.max_notas) >= 0.9 THEN 'sobrecarregado'
    WHEN iso.max_notas > 0 AND (iso.qtd_abertas::NUMERIC / iso.max_notas) >= 0.7 THEN 'carregado'
    WHEN iso.max_notas > 0 AND (iso.qtd_abertas::NUMERIC / iso.max_notas) >= 0.3 THEN 'equilibrado'
    ELSE 'ocioso'
  END AS workload_status,
  iso.qtd_notas_criticas,
  iso.qtd_ordens_vermelhas,
  COALESCE(c7.qtd, 0) AS concluidas_7d,
  COALESCE(c30.qtd, 0) AS concluidas_30d,
  ROUND(COALESCE(c30.qtd, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  a.em_ferias,
  a.recebe_distribuicao
FROM public.vw_iso_por_admin iso
JOIN public.administradores a ON a.id = iso.administrador_id
LEFT JOIN concluidas_7d c7 ON c7.administrador_id = iso.administrador_id
LEFT JOIN concluidas_30d c30 ON c30.administrador_id = iso.administrador_id
ORDER BY iso.iso_score DESC;


-- View: Produtividade detalhada por admin
CREATE OR REPLACE VIEW public.vw_produtividade_detalhada AS
WITH concluidas AS (
  SELECT
    n.administrador_id,
    h.created_at AS concluida_em
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= NOW() - INTERVAL '60 days'
),
agg AS (
  SELECT
    administrador_id,
    COUNT(*) FILTER (WHERE concluida_em >= NOW() - INTERVAL '7 days')::INT AS concluidas_7d,
    COUNT(*) FILTER (WHERE concluida_em >= NOW() - INTERVAL '30 days')::INT AS concluidas_30d,
    COUNT(*) FILTER (
      WHERE concluida_em >= NOW() - INTERVAL '60 days'
        AND concluida_em < NOW() - INTERVAL '30 days'
    )::INT AS concluidas_prev_30d
  FROM concluidas
  GROUP BY administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COALESCE(agg.concluidas_7d, 0) AS concluidas_7d,
  COALESCE(agg.concluidas_30d, 0) AS concluidas_30d,
  COALESCE(agg.concluidas_prev_30d, 0) AS concluidas_prev_30d,
  ROUND(COALESCE(agg.concluidas_30d, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  CASE
    WHEN COALESCE(agg.concluidas_prev_30d, 0) > 0
      THEN ROUND(
        ((COALESCE(agg.concluidas_30d, 0) - COALESCE(agg.concluidas_prev_30d, 0))::NUMERIC
        / agg.concluidas_prev_30d) * 100, 1
      )
    ELSE 0
  END AS variacao_pct,
  CASE
    WHEN (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)) > 0
      THEN ROUND(
        COALESCE(agg.concluidas_30d, 0)::NUMERIC
        / (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)), 3
      )
    ELSE 0
  END AS eficiencia
FROM public.administradores a
LEFT JOIN agg ON agg.administrador_id = a.id
LEFT JOIN public.vw_carga_administradores c ON c.id = a.id
WHERE a.role = 'admin'
  AND (a.recebe_distribuicao OR COALESCE(agg.concluidas_30d, 0) > 0)
ORDER BY COALESCE(agg.concluidas_30d, 0) DESC;
