-- =============================================
-- MIGRATION 00022: Copilot Phase 1 — ISO Views
-- Indice de Severidade Operacional por admin e global
-- =============================================

-- View: ISO por administrador
-- Calcula 4 componentes (25% cada):
--   nota_severity: media ponderada do aging das notas abertas
--   order_severity: % ordens com semaforo vermelho
--   workload_pressure: carga atual / max_notas * 100
--   critical_density: % notas com aging >= 3 dias
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
    COALESCE(c.qtd_abertas, 0)::INT AS qtd_abertas
  FROM public.administradores a
  LEFT JOIN public.vw_carga_administradores c ON c.id = a.id
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
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND n.administrador_id IS NOT NULL
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


-- View: ISO global (media ponderada por qtd_abertas)
CREATE OR REPLACE VIEW public.vw_iso_global AS
SELECT
  ROUND(
    CASE WHEN SUM(qtd_abertas) > 0
      THEN SUM(iso_score * qtd_abertas) / SUM(qtd_abertas)
      ELSE 0
    END::NUMERIC, 1
  ) AS iso_score,
  CASE
    WHEN CASE WHEN SUM(qtd_abertas) > 0
           THEN SUM(iso_score * qtd_abertas) / SUM(qtd_abertas)
           ELSE 0
         END >= 75 THEN 'critico'
    WHEN CASE WHEN SUM(qtd_abertas) > 0
           THEN SUM(iso_score * qtd_abertas) / SUM(qtd_abertas)
           ELSE 0
         END >= 50 THEN 'risco_alto'
    WHEN CASE WHEN SUM(qtd_abertas) > 0
           THEN SUM(iso_score * qtd_abertas) / SUM(qtd_abertas)
           ELSE 0
         END >= 25 THEN 'atencao'
    ELSE 'saudavel'
  END AS iso_faixa,
  COUNT(*)::INT AS total_admins,
  COALESCE(SUM(qtd_abertas), 0)::INT AS total_abertas,
  COUNT(*) FILTER (WHERE iso_faixa = 'critico')::INT AS admins_criticos
FROM public.vw_iso_por_admin;
