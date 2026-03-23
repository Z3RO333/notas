-- 00184_enable_rls_dim_operacionais.sql
-- Habilita RLS na tabela dim_operacionais que estava sem proteção.
-- Qualquer usuário autenticado pode ler (dados de referência),
-- mas nenhum pode escrever diretamente (apenas via service role / sync).

ALTER TABLE public.dim_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticado le operacionais"
  ON public.dim_operacionais
  FOR SELECT
  TO authenticated
  USING (true);
