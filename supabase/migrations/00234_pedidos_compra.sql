-- 00234_pedidos_compra.sql
-- Tabelas para o painel de Pedidos de Compra.
-- Dados originam do Databricks:
--   cabecalho: manutencao.silver.cabecalho_documento_compras
--   itens:     manutencao.silver.itens_documento_compras
--
-- Mapeamento cabecalho → pedidos_compra:
--   DOCUMENTO_COMPRAS    → documento_compras
--   CRIADO_POR           → sap_codigo (matricula SAP do criador)
--   FORNECEDOR           → fornecedor (código numérico SAP, ex: "0000012029")
--   DATA_DOCUMENTO       → data_documento
--   VALOR_TOTAL_LIB      → valor_liquido_total
--   STATUS_PROC          → status (02=em_aberto, 03=cancelado, 05=encerrado)
--   TIPO_DOCUMENTO_COMPRA→ tipo_documento
--   MES_EXTRACAO         → mes_extracao varchar(6) ex: "202501" (YYYYMM)
--
-- Mapeamento itens → pedidos_compra_itens:
--   DOCUMENTO_DE_COMPRAS → documento_compras (nome diferente do cabeçalho!)
--   ITEM                 → item_numero
--   TEXTO_BREVE          → descricao
--   CODIGO_MATERIAL      → codigo_material
--   GRUPO_DE_MERCADORIAS → grupo_mercadoria
--   QUANTIDADE_PEDIDO    → quantidade
--   UM_PEDIDO            → unidade_medida
--   PRECO_LIQUIDO        → preco_unitario
--   VALOR_LIQUIDO        → valor_liquido
--   CENTRO               → centro (código filial/loja)
--   REQUISICAO_DE_COMPRA → requisicao_compra

DO $$ BEGIN
  CREATE TYPE pedido_compra_status AS ENUM (
    'em_aberto',
    'cancelado',
    'encerrado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS pedidos_compra (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_compras     varchar(20) NOT NULL UNIQUE,
  administrador_id      uuid NOT NULL REFERENCES administradores(id),
  sap_codigo            varchar(20) NOT NULL,
  fornecedor            varchar(20),
  data_documento        date,
  valor_liquido_total   numeric(18, 2),
  status                pedido_compra_status NOT NULL DEFAULT 'em_aberto',
  tipo_documento        varchar(10),
  mes_extracao          varchar(6) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_compra_administrador_idx
  ON pedidos_compra (administrador_id);

CREATE INDEX IF NOT EXISTS pedidos_compra_status_idx
  ON pedidos_compra (status);

CREATE INDEX IF NOT EXISTS pedidos_compra_data_documento_idx
  ON pedidos_compra (data_documento DESC);

CREATE INDEX IF NOT EXISTS pedidos_compra_mes_extracao_idx
  ON pedidos_compra (mes_extracao DESC);

-- Itens: DOCUMENTO_DE_COMPRAS no Databricks → documento_compras aqui
CREATE TABLE IF NOT EXISTS pedidos_compra_itens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_compras   varchar(20) NOT NULL REFERENCES pedidos_compra(documento_compras) ON DELETE CASCADE,
  item_numero         varchar(10) NOT NULL,
  descricao           text,
  codigo_material     varchar(20),
  grupo_mercadoria    varchar(20),
  quantidade          numeric(18, 3),
  unidade_medida      varchar(10),
  preco_unitario      numeric(18, 2),
  valor_liquido       numeric(18, 2),
  centro              varchar(10),
  requisicao_compra   varchar(20),
  UNIQUE (documento_compras, item_numero)
);

CREATE INDEX IF NOT EXISTS pedidos_compra_itens_documento_idx
  ON pedidos_compra_itens (documento_compras);
