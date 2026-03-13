-- =============================================
-- MIGRATION 00159: Fix vw_radar_colaborador — usar qtd_abertas total para pct_carga
--
-- Problema: após 00158, vw_iso_por_admin.qtd_abertas usa vw_carga_real_administradores
-- (filtra notas com ordem ativa/SAP). Isso é correto para o ISO score, mas
-- vw_radar_colaborador herdava essa qtd_abertas filtrada para calcular pct_carga e
-- workload_status, resultando em todos os admins aparecendo como "Ocioso" (1% carga).
--
-- Fix: separar as duas fontes na view do radar:
--   - iso_score, iso_faixa, qtd_notas_criticas, qtd_ordens_vermelhas → vw_iso_por_admin
--   - qtd_abertas, pct_carga, workload_status → vw_carga_administradores (TOTAL, sem filtro SAP)
-- =============================================

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
  -- Usa qtd_abertas TOTAL (todas as notas abertas, sem filtro SAP/ordem)
  -- para refletir a carga de trabalho real do admin no radar
  COALESCE(carga.qtd_abertas, 0)::INT AS qtd_abertas,
  COALESCE(carga.max_notas, iso.max_notas, 0)::INT AS max_notas,
  -- pct_carga = total abertas / capacidade máxima
  ROUND(
    LEAST(
      CASE WHEN COALESCE(carga.max_notas, iso.max_notas, 0) > 0
        THEN (COALESCE(carga.qtd_abertas, 0)::NUMERIC
              / COALESCE(carga.max_notas, iso.max_notas)) * 100
        ELSE 0
      END,
      100
    ), 1
  ) AS pct_carga,
  CASE
    WHEN COALESCE(carga.max_notas, iso.max_notas, 0) > 0
      AND (COALESCE(carga.qtd_abertas, 0)::NUMERIC
           / COALESCE(carga.max_notas, iso.max_notas)) >= 0.9 THEN 'sobrecarregado'
    WHEN COALESCE(carga.max_notas, iso.max_notas, 0) > 0
      AND (COALESCE(carga.qtd_abertas, 0)::NUMERIC
           / COALESCE(carga.max_notas, iso.max_notas)) >= 0.7 THEN 'carregado'
    WHEN COALESCE(carga.max_notas, iso.max_notas, 0) > 0
      AND (COALESCE(carga.qtd_abertas, 0)::NUMERIC
           / COALESCE(carga.max_notas, iso.max_notas)) >= 0.3 THEN 'equilibrado'
    ELSE 'ocioso'
  END AS workload_status,
  -- qtd_notas_criticas e qtd_ordens_vermelhas continuam do ISO (filtradas)
  iso.qtd_notas_criticas,
  iso.qtd_ordens_vermelhas,
  COALESCE(c7.qtd, 0) AS concluidas_7d,
  COALESCE(c30.qtd, 0) AS concluidas_30d,
  ROUND(COALESCE(c30.qtd, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  a.em_ferias,
  a.recebe_distribuicao
FROM public.vw_iso_por_admin iso
JOIN public.administradores a ON a.id = iso.administrador_id
-- Join com vw_carga_administradores para qtd_abertas TOTAL (workload real)
LEFT JOIN public.vw_carga_administradores carga ON carga.id = iso.administrador_id
LEFT JOIN concluidas_7d c7 ON c7.administrador_id = iso.administrador_id
LEFT JOIN concluidas_30d c30 ON c30.administrador_id = iso.administrador_id
ORDER BY iso.iso_score DESC;
