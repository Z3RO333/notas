-- 00267_pedidos_compra_add_nf_referencias.sql
-- Armazena os números de referência de NF vinculados a cada pedido,
-- obtidos do historico_documento_compra do Databricks (categorias Q e L).

ALTER TABLE pedidos_compra
  ADD COLUMN IF NOT EXISTS nf_referencias TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN pedidos_compra.nf_referencias IS
  'Números de referência de NF do fornecedor (NUMERO_DOCUMENTO_REFERENCIA do SAP, categorias Q/L)';

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_nf_referencias
  ON pedidos_compra USING GIN (nf_referencias);
