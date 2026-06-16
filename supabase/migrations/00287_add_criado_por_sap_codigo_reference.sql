-- The heavy Databricks job persists the raw SAP order creator before the
-- enrichment RPC resolves it to an internal administrator.

ALTER TABLE public.ordens_manutencao_referencia
  ADD COLUMN IF NOT EXISTS criado_por_sap_codigo TEXT;

COMMENT ON COLUMN public.ordens_manutencao_referencia.criado_por_sap_codigo IS
  'Codigo SAP bruto do criador da ordem, usado pelo enriquecimento de ordens.';
