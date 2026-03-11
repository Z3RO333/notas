-- 00148_add_inicio_programado_pmpl.sql
--
-- Adiciona coluna inicio_programado para ordens PMPL.
-- Para PMPL, a competência financeira é o mês de execução planejada
-- (Início prog. do SAP), não a data de entrada no sistema.
-- Para PMOS, continua usando data_entrada.

ALTER TABLE public.ordens_financeiro_importado
  ADD COLUMN IF NOT EXISTS inicio_programado DATE;

COMMENT ON COLUMN public.ordens_financeiro_importado.inicio_programado IS
  'Data de início programado (SAP: Início prog.) — usada como competência para PMPL.';

-- Índice para filtros por início programado
CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_inicio_programado
  ON public.ordens_financeiro_importado (inicio_programado)
  WHERE inicio_programado IS NOT NULL;

-- Recriar view com competência correta:
-- PMPL → inicio_programado (quando preenchido), fallback data_entrada
-- PMOS → data_entrada
DROP VIEW IF EXISTS public.vw_financeiro_ordens;

CREATE VIEW public.vw_financeiro_ordens AS
SELECT
  f.id,
  f.ordem_codigo,
  f.tipo_ordem,
  f.numero_nota,
  f.data_entrada,
  f.inicio_programado,
  f.denominacao_unidade,
  f.texto_breve,
  f.fornecedor_codigo,
  f.fornecedor_nome,
  f.custos_estimados,
  f.custos_totais_materiais,
  f.custos_adicionais,
  f.custos_totais_reais,
  -- Data de competência: PMPL usa início programado, PMOS usa data de entrada
  CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado
    ELSE f.data_entrada
  END AS data_competencia,
  EXTRACT(YEAR  FROM CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado ELSE f.data_entrada END)::INT AS competencia_ano,
  EXTRACT(MONTH FROM CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado ELSE f.data_entrada END)::INT AS competencia_mes,
  GREATEST(COALESCE(f.custos_totais_reais, 0), 0::NUMERIC) AS valor_realizado,
  CASE
    WHEN COALESCE(f.custos_totais_reais, 0) > 0 THEN 0::NUMERIC
    ELSE GREATEST(COALESCE(f.custos_estimados, 0), 0::NUMERIC)
  END AS valor_previsto_pendente,
  (COALESCE(f.custos_totais_reais, 0) > 0) AS tem_custo_real,
  GREATEST(
    COALESCE(f.custos_totais_reais, 0)
      - COALESCE(f.custos_totais_materiais, 0)
      - COALESCE(f.custos_adicionais, 0),
    0::NUMERIC
  ) AS valor_servico_calculado,
  f.source_file_name,
  f.imported_by,
  f.importado_em,
  f.created_at,
  f.updated_at
FROM public.ordens_financeiro_importado f
WHERE BTRIM(f.ordem_codigo) <> '';

ALTER VIEW public.vw_financeiro_ordens SET (security_invoker = on);

COMMENT ON VIEW public.vw_financeiro_ordens IS
  'Camada de leitura da página Financeiro. Competência: PMPL usa inicio_programado, PMOS usa data_entrada.';
