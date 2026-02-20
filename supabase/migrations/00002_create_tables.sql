-- 00002_create_tables.sql
-- Tabelas do cockpit de distribuição de notas

-- Trigger helper para updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ADMINISTRADORES
-- Perfis dos admins/gestores vinculados ao Supabase Auth
-- ============================================================
CREATE TABLE public.administradores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          user_role NOT NULL DEFAULT 'admin',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  max_notas     INTEGER NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_administradores_updated
  BEFORE UPDATE ON public.administradores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- NOTAS_MANUTENCAO
-- Tabela principal: cada linha e uma nota SAP do streaming
-- ============================================================
CREATE TABLE public.notas_manutencao (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Campos SAP (mapeados do Databricks streaming)
  numero_nota           TEXT NOT NULL UNIQUE,        -- NUMERO_NOTA (chave)
  tipo_nota             TEXT,                         -- TIPO_NOTA
  descricao             TEXT NOT NULL DEFAULT '',     -- TEXTO_BREVE
  descricao_objeto      TEXT,                         -- TEXTO_DESC_OBJETO
  prioridade            TEXT,                         -- PRIORIDADE
  tipo_prioridade       TEXT,                         -- TIPO_PRIORIDADE
  criado_por_sap        TEXT,                         -- CRIADO_POR
  solicitante           TEXT,                         -- SOLICITANTE
  data_criacao_sap      DATE,                         -- DATA_CRIACAO
  data_nota             DATE,                         -- DATA_NOTA
  hora_nota             TEXT,                         -- HORA_NOTA
  ordem_sap             TEXT,                         -- ORDEM
  centro                TEXT,                         -- CENTRO_MATERIAL
  status_sap            TEXT,                         -- STATUS_OBJ_ADMIN
  conta_fornecedor      TEXT,                         -- N_CONTA_FORNECEDOR
  autor_nota            TEXT,                         -- AUTOR_NOTA_QM_PM
  streaming_timestamp   TIMESTAMPTZ,                  -- __timestamp (watermark)

  -- Status e distribuição do cockpit
  status                nota_status NOT NULL DEFAULT 'nova',
  administrador_id      UUID REFERENCES public.administradores(id),
  distribuida_em        TIMESTAMPTZ,

  -- Campos de tratativa (preenchidos pelo admin)
  ordem_gerada          TEXT,                         -- Ordem que o admin criou
  fornecedor_encaminhado TEXT,                        -- Fornecedor escolhido
  observacoes           TEXT,                         -- Notas do admin

  -- Metadata de sync
  sync_id               UUID,
  raw_data              JSONB,                        -- Payload completo do Databricks

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_notas_updated
  BEFORE UPDATE ON public.notas_manutencao
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- NOTAS_HISTORICO
-- Auditoria: toda mudanca de status ou reatribuição
-- ============================================================
CREATE TABLE public.notas_historico (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id         UUID NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  campo_alterado  TEXT NOT NULL,
  valor_anterior  TEXT,
  valor_novo      TEXT,
  alterado_por    UUID REFERENCES public.administradores(id),
  motivo          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SYNC_LOG
-- Log de cada ciclo de sincronizacao Databricks -> Supabase
-- ============================================================
CREATE TABLE public.sync_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running',
  notas_lidas         INTEGER DEFAULT 0,
  notas_inseridas     INTEGER DEFAULT 0,
  notas_atualizadas   INTEGER DEFAULT 0,
  notas_distribuidas  INTEGER DEFAULT 0,
  erro_mensagem       TEXT,
  databricks_job_id   TEXT,
  metadata            JSONB
);

-- ============================================================
-- DISTRIBUICAO_LOG
-- Registro de cada decisao de atribuição
-- ============================================================
CREATE TABLE public.distribuicao_log (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id                   UUID NOT NULL REFERENCES public.notas_manutencao(id),
  administrador_id          UUID NOT NULL REFERENCES public.administradores(id),
  notas_abertas_no_momento  INTEGER NOT NULL,
  sync_id                   UUID REFERENCES public.sync_log(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
