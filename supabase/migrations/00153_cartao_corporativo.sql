-- 00153_cartao_corporativo.sql
--
-- Tabela para gastos do cartao corporativo (Alelo Despesas),
-- independente das ordens PMOS/PMPL.

CREATE TABLE IF NOT EXISTS public.cartao_corporativo_gastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  fornecedor TEXT NOT NULL,
  centro_custo TEXT,
  valor NUMERIC(14,2) NOT NULL,
  ano INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM data)::integer) STORED,
  mes INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM data)::integer) STORED,
  source_sheet TEXT,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartao_corporativo_gastos_unico
    UNIQUE (data, fornecedor, centro_custo, valor)
);

CREATE INDEX IF NOT EXISTS idx_cartao_corporativo_gastos_ano_mes
  ON public.cartao_corporativo_gastos (ano, mes);

CREATE INDEX IF NOT EXISTS idx_cartao_corporativo_gastos_fornecedor
  ON public.cartao_corporativo_gastos (fornecedor);

CREATE INDEX IF NOT EXISTS idx_cartao_corporativo_gastos_centro_custo
  ON public.cartao_corporativo_gastos (centro_custo);

COMMENT ON TABLE public.cartao_corporativo_gastos IS
  'Gastos do cartao corporativo Alelo Despesas importados manualmente por aba anual.';

-- RLS
ALTER TABLE public.cartao_corporativo_gastos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado le cartao corporativo" ON public.cartao_corporativo_gastos;
CREATE POLICY "Autenticado le cartao corporativo"
  ON public.cartao_corporativo_gastos FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Gestor insere cartao corporativo" ON public.cartao_corporativo_gastos;
CREATE POLICY "Gestor insere cartao corporativo"
  ON public.cartao_corporativo_gastos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.administradores a
      WHERE a.email = auth.jwt() ->> 'email'
        AND a.role = 'gestor'
    )
  );

DROP POLICY IF EXISTS "Gestor deleta cartao corporativo" ON public.cartao_corporativo_gastos;
CREATE POLICY "Gestor deleta cartao corporativo"
  ON public.cartao_corporativo_gastos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.administradores a
      WHERE a.email = auth.jwt() ->> 'email'
        AND a.role = 'gestor'
    )
  );
