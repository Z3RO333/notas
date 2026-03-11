-- 00146_financeiro_por_ordem.sql
--
-- Base financeira operacional por ordem, alimentada por importação manual
-- da planilha SAP combinada (PMOS + PMPL).

CREATE TABLE IF NOT EXISTS public.ordens_financeiro_importado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_codigo TEXT NOT NULL,
  tipo_ordem TEXT NOT NULL CHECK (tipo_ordem IN ('PMOS', 'PMPL')),
  numero_nota TEXT,
  data_entrada DATE NOT NULL,
  denominacao_unidade TEXT,
  texto_breve TEXT,
  fornecedor_codigo TEXT,
  fornecedor_nome TEXT,
  custos_estimados NUMERIC(14,2) NOT NULL DEFAULT 0,
  custos_totais_materiais NUMERIC(14,2) NOT NULL DEFAULT 0,
  custos_adicionais NUMERIC(14,2) NOT NULL DEFAULT 0,
  custos_totais_reais NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_file_name TEXT,
  imported_by UUID REFERENCES public.administradores(id) ON DELETE SET NULL,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ordens_financeiro_importado
  ADD CONSTRAINT ordens_financeiro_importado_ordem_codigo_key UNIQUE (ordem_codigo);

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_tipo_data
  ON public.ordens_financeiro_importado (tipo_ordem, data_entrada);

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_unidade
  ON public.ordens_financeiro_importado (denominacao_unidade);

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_servico
  ON public.ordens_financeiro_importado (texto_breve);

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_fornecedor
  ON public.ordens_financeiro_importado (fornecedor_nome);

COMMENT ON TABLE public.ordens_financeiro_importado IS
  'Snapshot financeiro operacional por ordem importado manualmente da planilha SAP.';

COMMENT ON COLUMN public.ordens_financeiro_importado.custos_estimados IS
  'Campo Custs.estimados da planilha SAP.';

COMMENT ON COLUMN public.ordens_financeiro_importado.custos_totais_materiais IS
  'Campo Custos tot.mat. da planilha SAP.';

COMMENT ON COLUMN public.ordens_financeiro_importado.custos_adicionais IS
  'Campo Custs.adicionais da planilha SAP.';

COMMENT ON COLUMN public.ordens_financeiro_importado.custos_totais_reais IS
  'Campo Cust.tot.reais da planilha SAP.';

ALTER TABLE public.ordens_financeiro_importado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado lê ordens financeiras importadas" ON public.ordens_financeiro_importado;
CREATE POLICY "Autenticado lê ordens financeiras importadas"
  ON public.ordens_financeiro_importado FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gestor escreve ordens financeiras importadas" ON public.ordens_financeiro_importado;
CREATE POLICY "Gestor escreve ordens financeiras importadas"
  ON public.ordens_financeiro_importado FOR ALL TO authenticated
  USING (get_my_role() = 'gestor'::user_role)
  WITH CHECK (get_my_role() = 'gestor'::user_role);

DROP VIEW IF EXISTS public.vw_financeiro_ordens;

CREATE VIEW public.vw_financeiro_ordens AS
SELECT
  f.id,
  f.ordem_codigo,
  f.tipo_ordem,
  f.numero_nota,
  f.data_entrada,
  f.denominacao_unidade,
  f.texto_breve,
  f.fornecedor_codigo,
  f.fornecedor_nome,
  f.custos_estimados,
  f.custos_totais_materiais,
  f.custos_adicionais,
  f.custos_totais_reais,
  EXTRACT(YEAR FROM f.data_entrada)::INT AS competencia_ano,
  EXTRACT(MONTH FROM f.data_entrada)::INT AS competencia_mes,
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
  'Camada de leitura da página Financeiro, com competência e valores derivados por ordem.';
