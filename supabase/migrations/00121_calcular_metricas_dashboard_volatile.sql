-- Migration 00121: muda calcular_metricas_notas_dashboard para VOLATILE
-- STABLE permite que PostgREST sirva via GET (com cache), causando retorno de valor antigo.
-- VOLATILE força POST em toda chamada, garantindo resultado sempre fresco.

CREATE OR REPLACE FUNCTION public.calcular_metricas_notas_dashboard(
  p_start_iso TIMESTAMP WITH TIME ZONE,
  p_end_exclusive_iso TIMESTAMP WITH TIME ZONE
)
RETURNS json
LANGUAGE sql
VOLATILE
SET search_path TO 'public'
AS $function$
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
      COALESCE((n.data_criacao_sap::TIMESTAMP AT TIME ZONE 'UTC'), n.created_at) AS referencia_criacao,
      aux.status_canonico AS sap_aux_status
    FROM public.notas_manutencao n
    JOIN periodo p ON TRUE
    LEFT JOIN public.notas_status_sap_aux aux
      ON aux.numero_nota_norm = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
    WHERE (n.data_criacao_sap IS NOT NULL AND n.data_criacao_sap >= p.start_date AND n.data_criacao_sap < p.end_date_exclusive)
       OR (n.data_criacao_sap IS NULL AND n.created_at >= p.start_iso AND n.created_at < p.end_exclusive_iso)
  ),
  conclusoes_unicas AS (
    SELECT h.nota_id, MIN(h.created_at) AS concluida_em
    FROM public.notas_historico h
    WHERE h.campo_alterado = 'status' AND h.valor_novo = 'concluida'
    GROUP BY h.nota_id
  ),
  agg_notas AS (
    SELECT
      COUNT(*)::INTEGER AS qtd_notas_criadas_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          AND (n.sap_aux_status IS NULL OR n.sap_aux_status NOT IN ('CANCELADA', 'VIROU_ORDEM'))
      )::INTEGER AS abertas_periodo,
      COUNT(*) FILTER (
        WHERE n.status = 'nova' AND n.administrador_id IS NULL
          AND (n.sap_aux_status IS NULL OR n.sap_aux_status NOT IN ('CANCELADA', 'VIROU_ORDEM'))
      )::INTEGER AS sem_atribuir_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          AND (n.sap_aux_status IS NULL OR n.sap_aux_status NOT IN ('CANCELADA', 'VIROU_ORDEM'))
          AND now() - n.referencia_criacao > INTERVAL '48 hours'
      )::INTEGER AS aging_48h_periodo
    FROM notas_base n
  ),
  agg_convertidas AS (
    SELECT COUNT(DISTINCT n.id)::INTEGER AS qtd_notas_convertidas_periodo
    FROM notas_base n
    JOIN public.ordens_notas_acompanhamento o ON o.nota_id = n.id
    JOIN periodo p ON TRUE
    WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) < p.end_exclusive_iso
  ),
  agg_concluidas AS (
    SELECT COUNT(*)::INTEGER AS qtd_concluidas_periodo
    FROM conclusoes_unicas c
    JOIN periodo p ON TRUE
    WHERE c.concluida_em >= p.start_iso AND c.concluida_em < p.end_exclusive_iso
  )
  SELECT json_build_object(
    'abertas_periodo',               a.abertas_periodo,
    'sem_atribuir_periodo',          a.sem_atribuir_periodo,
    'aging_48h_periodo',             a.aging_48h_periodo,
    'qtd_notas_criadas_periodo',     a.qtd_notas_criadas_periodo,
    'qtd_notas_convertidas_periodo', c.qtd_notas_convertidas_periodo,
    'qtd_concluidas_periodo',        f.qtd_concluidas_periodo,
    'taxa_nota_ordem_periodo',       ROUND(c.qtd_notas_convertidas_periodo::NUMERIC / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC, 4),
    'taxa_fechamento_periodo',       ROUND(f.qtd_concluidas_periodo::NUMERIC / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC, 4)
  )
  FROM agg_notas a
  CROSS JOIN agg_convertidas c
  CROSS JOIN agg_concluidas f;
$function$;
