-- =============================================
-- MIGRATION 00158: Fix Copilot Views — aplicar filtros de vw_notas_sem_ordem
--
-- Problema: vw_iso_por_admin e vw_produtividade_detalhada usavam
-- vw_carga_administradores, que conta TODAS as notas abertas sem filtrar
-- as que já têm ordem SAP ativa. Isso inflava qtd_abertas, workload_pressure,
-- critical_density e eficiencia no Copilot.
--
-- Fix: trocar por vw_carga_real_administradores (usa os mesmos filtros de
-- vw_notas_sem_ordem) e aplicar os mesmos filtros no CTE nota_aging.
-- =============================================

-- ============================================================
-- 1. vw_iso_por_admin — reescrita com filtros corretos
-- ============================================================
CREATE OR REPLACE VIEW public.vw_iso_por_admin AS
WITH
-- Notas com ordem ativa no cockpit (para exclusão)
ordens_ativas_ids AS (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE status_ordem NOT IN ('concluida', 'cancelada')
    AND nota_id IS NOT NULL
),
admin_base AS (
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade,
    a.max_notas,
    a.ativo,
    a.recebe_distribuicao,
    a.em_ferias,
    COALESCE(c.qtd_abertas, 0)::INT AS qtd_abertas
  FROM public.administradores a
  -- Usa vw_carga_real_administradores para qtd_abertas com filtros corretos
  LEFT JOIN public.vw_carga_real_administradores c ON c.id = a.id
  WHERE a.role = 'admin'
),
nota_aging AS (
  SELECT
    n.administrador_id,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 4 THEN 100
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 3 THEN 80
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 2 THEN 60
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 1 THEN 30
      ELSE 0
    END AS peso,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 3 THEN 1
      ELSE 0
    END AS is_critico
  FROM public.notas_manutencao n
  LEFT JOIN ordens_ativas_ids oa ON oa.nota_id = n.id
  LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
    ON sap_aux.numero_nota_norm
       = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND n.administrador_id IS NOT NULL
    -- Mesmos filtros de vw_notas_sem_ordem:
    AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
    AND oa.nota_id IS NULL
    AND (sap_aux.status_canonico IS NULL
         OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
),
nota_agg AS (
  SELECT
    administrador_id,
    COALESCE(AVG(peso), 0) AS nota_severity,
    COALESCE(SUM(is_critico), 0)::INT AS qtd_notas_criticas
  FROM nota_aging
  GROUP BY administrador_id
),
ordem_agg AS (
  SELECT
    o.administrador_id,
    COUNT(*) FILTER (WHERE o.semaforo_atraso = 'vermelho') AS qtd_vermelhas,
    COUNT(*) AS qtd_total
  FROM public.vw_ordens_notas_painel o
  WHERE o.administrador_id IS NOT NULL
    AND o.status_ordem NOT IN ('concluida', 'cancelada')
  GROUP BY o.administrador_id
)
SELECT
  ab.administrador_id,
  ab.nome,
  ab.avatar_url,
  ab.especialidade,
  ROUND(COALESCE(na.nota_severity, 0)::NUMERIC, 1) AS nota_severity,
  ROUND(
    CASE WHEN COALESCE(oa.qtd_total, 0) > 0
      THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100
      ELSE 0
    END, 1
  ) AS order_severity,
  ROUND(
    LEAST(
      CASE WHEN ab.max_notas > 0
        THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
        ELSE 0
      END,
      100
    ), 1
  ) AS workload_pressure,
  ROUND(
    CASE WHEN ab.qtd_abertas > 0
      THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100
      ELSE 0
    END, 1
  ) AS critical_density,
  ROUND(
    (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE WHEN ab.max_notas > 0
            THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE WHEN ab.qtd_abertas > 0
          THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    )::NUMERIC, 1
  ) AS iso_score,
  CASE
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE WHEN ab.max_notas > 0
            THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE WHEN ab.qtd_abertas > 0
          THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 75 THEN 'critico'
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE WHEN ab.max_notas > 0
            THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE WHEN ab.qtd_abertas > 0
          THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 50 THEN 'risco_alto'
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE WHEN COALESCE(oa.qtd_total, 0) > 0
          THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE WHEN ab.max_notas > 0
            THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE WHEN ab.qtd_abertas > 0
          THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 25 THEN 'atencao'
    ELSE 'saudavel'
  END AS iso_faixa,
  ab.qtd_abertas,
  ab.max_notas,
  COALESCE(na.qtd_notas_criticas, 0)::INT AS qtd_notas_criticas,
  COALESCE(oa.qtd_vermelhas, 0)::INT AS qtd_ordens_vermelhas
FROM admin_base ab
LEFT JOIN nota_agg na ON na.administrador_id = ab.administrador_id
LEFT JOIN ordem_agg oa ON oa.administrador_id = ab.administrador_id
WHERE ab.qtd_abertas > 0 OR ab.recebe_distribuicao OR ab.em_ferias
ORDER BY iso_score DESC;


-- ============================================================
-- 2. vw_produtividade_detalhada — trocar vw_carga_administradores
--    por vw_carga_real_administradores no cálculo de eficiencia
-- ============================================================
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
    COUNT(*) FILTER (WHERE concluida_em >= NOW() - INTERVAL '7 days')::INT  AS concluidas_7d,
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
  COALESCE(agg.concluidas_7d, 0)      AS concluidas_7d,
  COALESCE(agg.concluidas_30d, 0)     AS concluidas_30d,
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
-- Usa vw_carga_real_administradores para eficiencia com qtd_abertas correto
LEFT JOIN public.vw_carga_real_administradores c ON c.id = a.id
WHERE a.role = 'admin'
  AND (a.recebe_distribuicao OR COALESCE(agg.concluidas_30d, 0) > 0)
ORDER BY COALESCE(agg.concluidas_30d, 0) DESC;
