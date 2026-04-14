-- 00223_add_criado_por_sap_codigo_ordens.sql
--
-- A migration 00093 deveria ter adicionado criado_por_sap_codigo TEXT em
-- ordens_notas_acompanhamento, mas foi aplicada via MCP sem o SQL registrado.
-- O heavy job falha com "column does not exist" ao chamar
-- enriquecer_ordens_por_referencia_manutencao / importar_ordens_pmpl_standalone.

ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS criado_por_sap_codigo TEXT;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.criado_por_sap_codigo IS
  'Código SAP bruto do criador da ordem (CRIADO_POR / ERNAM da tabela de ordens PM). '
  'Complementa criado_por (UUID) — propagado via enriquecer_ordens_por_referencia_manutencao '
  'e importar_ordens_pmpl_standalone a partir de ordens_manutencao_referencia.';
