-- 00199_calcular_evolucao_mensal_admin.sql
--
-- Cria RPC calcular_evolucao_mensal_admin que agrega evolução mensal de ordens
-- por status (concluidas vs em_aberto) para o painel de administradores.
--
-- Substitui 6 chamadas separadas de calcular_kpis_ordens_operacional por uma
-- única query agrupada por mês, reduzindo o número de RPCs do painel de ~13 para ~8.
--
-- Usa ordem_detectada_em como campo de data (consistente com filtrar_ordens_workspace_core).
-- Usa classificar_status_ordem_raw() para classificação de bucket (consistente com workspace).

CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_admin(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ
)
RETURNS TABLE(
  ano        INTEGER,
  mes        INTEGER,
  label      TEXT,
  concluidas INTEGER,
  em_aberto  INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.ordem_detectada_em,
      public.classificar_status_ordem_raw(COALESCE(o.status_ordem_raw, '')) AS bucket
    FROM public.ordens_notas_acompanhamento o
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
  )
  SELECT
    EXTRACT(YEAR  FROM b.ordem_detectada_em)::INTEGER                        AS ano,
    EXTRACT(MONTH FROM b.ordem_detectada_em)::INTEGER                        AS mes,
    TO_CHAR(DATE_TRUNC('month', b.ordem_detectada_em), 'Mon/YY')             AS label,
    COUNT(*) FILTER (WHERE b.bucket = 'concluida')::INTEGER                  AS concluidas,
    COUNT(*) FILTER (
      WHERE b.bucket IN ('aberta', 'em_tratativa', 'em_avaliacao')
    )::INTEGER                                                                AS em_aberto
  FROM base b
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;
