-- =============================================================
-- 001_initial_schema.sql
-- Schema inicial consolidado — Cockpit de Manutenção
--
-- Gerado a partir das migrations 00001–00080 do projeto legado.
-- Inclui apenas o estado final (sem patches intermediários).
--
-- Padrões aplicados:
--   • RLS habilitado em todas as tabelas desde o início
--   • Views com SECURITY INVOKER (respeita RLS do chamador)
--   • Funções com SET search_path = public
--   • Sem seed de usuários (admins cadastrados via Auth)
--   • Dados de referência incluídos (centros, regras de distribuição)
--
-- Roles de acesso:
--   anon            → bloqueado em tudo
--   authenticated admin  → vê e edita apenas seus dados
--   authenticated gestor → vê e edita tudo
--   service_role (jobs)  → bypass de RLS automático
-- =============================================================

-- =============================================================
-- PARTE 1: ENUMS
-- =============================================================

CREATE TYPE public.nota_status AS ENUM (
  'nova',                    -- Nota recebida, aguardando tratativa
  'em_andamento',            -- Admin está trabalhando na nota
  'encaminhada_fornecedor',  -- Ordem gerada e encaminhada ao fornecedor
  'concluida',               -- Tratativa finalizada
  'cancelada'                -- Nota cancelada/inválida
);

CREATE TYPE public.user_role AS ENUM (
  'admin',   -- Administrador de manutenção (processa notas)
  'gestor'   -- Gestor (vê tudo, reatribui, monitora)
);

CREATE TYPE public.ordem_status_acomp AS ENUM (
  'aberta',
  'em_tratativa',
  'concluida',
  'cancelada',
  'desconhecido'
);

-- =============================================================
-- PARTE 2: FUNÇÕES AUXILIARES (sem dependência de tabela)
-- =============================================================

-- Trigger helper: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Helper RLS: retorna o ID do admin autenticado
CREATE OR REPLACE FUNCTION public.get_my_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.administradores WHERE auth_user_id = auth.uid();
$$;

-- Helper RLS: retorna o role do usuário autenticado
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.administradores WHERE auth_user_id = auth.uid();
$$;

-- Normaliza status de ordem vindo do SAP/PMPL para o enum interno
CREATE OR REPLACE FUNCTION public.normalizar_status_ordem(p_raw TEXT)
RETURNS public.ordem_status_acomp
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_raw TEXT := UPPER(BTRIM(COALESCE(p_raw, '')));
BEGIN
  IF v_raw = '' THEN RETURN 'desconhecido'; END IF;
  IF v_raw IN ('ABERTO') THEN RETURN 'aberta'; END IF;
  IF v_raw IN (
    'EM_PROCESSAMENTO', 'EM_EXECUCAO', 'AVALIACAO_DA_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO', 'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR'
  ) THEN RETURN 'em_tratativa'; END IF;
  IF v_raw IN ('CONCLUIDO', 'AGUARDANDO_FATURAMENTO_NF', 'EXECUCAO_SATISFATORIO')
    THEN RETURN 'concluida'; END IF;
  IF v_raw = 'CANCELADO' THEN RETURN 'cancelada'; END IF;
  RETURN 'desconhecido';
END;
$$;

-- Helpers de classificação de status raw
CREATE OR REPLACE FUNCTION public._is_em_avaliacao(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT UPPER(TRIM(COALESCE(p_raw, ''))) IN ('AVALIACAO_DA_EXECUCAO');
$$;

CREATE OR REPLACE FUNCTION public._is_avaliada(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT UPPER(TRIM(COALESCE(p_raw, ''))) IN (
    'EXECUCAO_SATISFATORIO', 'EXECUCAO_NAO_REALIZADA'
  );
$$;

CREATE OR REPLACE FUNCTION public._is_em_processamento(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT UPPER(TRIM(COALESCE(p_raw, ''))) IN ('EM_PROCESSAMENTO');
$$;

-- Normaliza código de centro
CREATE OR REPLACE FUNCTION public.normalizar_centro_codigo(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(BTRIM(COALESCE(p_raw, '')), '');
$$;

-- =============================================================
-- PARTE 3: TABELAS (ordem de dependência)
-- =============================================================

-- ------------------------------------------------------------
-- administradores
-- Perfis de usuários vinculados ao Supabase Auth
-- ------------------------------------------------------------
CREATE TABLE public.administradores (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome                 TEXT        NOT NULL,
  email                TEXT        NOT NULL UNIQUE,
  role                 public.user_role NOT NULL DEFAULT 'admin',
  ativo                BOOLEAN     NOT NULL DEFAULT true,
  max_notas            INTEGER     NOT NULL DEFAULT 50,
  avatar_url           TEXT,
  especialidade        TEXT        NOT NULL DEFAULT 'geral',
  recebe_distribuicao  BOOLEAN     NOT NULL DEFAULT true,
  em_ferias            BOOLEAN     NOT NULL DEFAULT false,
  motivo_bloqueio      TEXT,
  data_inicio_ferias   DATE,
  data_fim_ferias      DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_intervalo_ferias CHECK (
    data_inicio_ferias IS NULL
    OR data_fim_ferias IS NULL
    OR data_fim_ferias >= data_inicio_ferias
  )
);

CREATE TRIGGER trg_administradores_updated
  BEFORE UPDATE ON public.administradores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.administradores IS
  'Perfis de admins e gestores vinculados ao Supabase Auth.';

-- ------------------------------------------------------------
-- sync_log
-- Log de cada ciclo de sincronização Databricks → Supabase
-- ------------------------------------------------------------
CREATE TABLE public.sync_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'running',
  notas_lidas         INTEGER     DEFAULT 0,
  notas_inseridas     INTEGER     DEFAULT 0,
  notas_atualizadas   INTEGER     DEFAULT 0,
  notas_distribuidas  INTEGER     DEFAULT 0,
  erro_mensagem       TEXT,
  databricks_job_id   TEXT,
  metadata            JSONB
);

COMMENT ON TABLE public.sync_log IS
  'Registro de cada execução do job de sync Databricks → Supabase.';

-- ------------------------------------------------------------
-- notas_manutencao
-- Tabela principal: cada linha é uma nota SAP do streaming
-- ------------------------------------------------------------
CREATE TABLE public.notas_manutencao (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Campos SAP (mapeados do Databricks)
  numero_nota           TEXT        NOT NULL UNIQUE,
  tipo_nota             TEXT,
  descricao             TEXT        NOT NULL DEFAULT '',
  descricao_objeto      TEXT,
  prioridade            TEXT,
  tipo_prioridade       TEXT,
  criado_por_sap        TEXT,
  solicitante           TEXT,
  data_criacao_sap      DATE,
  data_nota             DATE,
  hora_nota             TEXT,
  ordem_sap             TEXT,
  centro                TEXT,
  status_sap            TEXT,
  conta_fornecedor      TEXT,
  autor_nota            TEXT,
  streaming_timestamp   TIMESTAMPTZ,

  -- Status e distribuição do cockpit
  status                public.nota_status NOT NULL DEFAULT 'nova',
  administrador_id      UUID        REFERENCES public.administradores(id),
  distribuida_em        TIMESTAMPTZ,

  -- Campos de tratativa (preenchidos pelo admin)
  ordem_gerada          TEXT,
  fornecedor_encaminhado TEXT,
  observacoes           TEXT,

  -- Metadata de sync
  sync_id               UUID,
  raw_data              JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_notas_updated
  BEFORE UPDATE ON public.notas_manutencao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.notas_manutencao IS
  'Notas de manutenção recebidas via streaming do SAP/Databricks.';

-- ------------------------------------------------------------
-- notas_historico
-- Auditoria: toda mudança de campo relevante
-- ------------------------------------------------------------
CREATE TABLE public.notas_historico (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id        UUID        NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  campo_alterado TEXT        NOT NULL,
  valor_anterior TEXT,
  valor_novo     TEXT,
  alterado_por   UUID        REFERENCES public.administradores(id),
  motivo         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notas_historico IS
  'Trilha de auditoria de mudanças em notas_manutencao.';

-- ------------------------------------------------------------
-- distribuicao_log
-- Registro de cada decisão de atribuição automática
-- ------------------------------------------------------------
CREATE TABLE public.distribuicao_log (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id                   UUID        NOT NULL REFERENCES public.notas_manutencao(id),
  administrador_id          UUID        NOT NULL REFERENCES public.administradores(id),
  notas_abertas_no_momento  INTEGER     NOT NULL,
  sync_id                   UUID        REFERENCES public.sync_log(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.distribuicao_log IS
  'Log de atribuições automáticas de notas.';

-- ------------------------------------------------------------
-- admin_audit_log
-- Auditoria de ações administrativas de gestores
-- ------------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id  UUID        NOT NULL REFERENCES public.administradores(id),
  acao       TEXT        NOT NULL,
  alvo_id    UUID        REFERENCES public.administradores(id),
  detalhes   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_log IS
  'Auditoria de ações administrativas realizadas por gestores.';

-- ------------------------------------------------------------
-- regras_distribuicao
-- Palavras-chave para roteamento automático de notas por especialidade
-- ------------------------------------------------------------
CREATE TABLE public.regras_distribuicao (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  palavra_chave TEXT       NOT NULL,
  especialidade TEXT       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.regras_distribuicao IS
  'Regras de roteamento: palavra-chave em descricao → especialidade do admin.';

-- ------------------------------------------------------------
-- dim_centro_unidade
-- Dimensão de referência: código de centro SAP → nome da unidade
-- ------------------------------------------------------------
CREATE TABLE public.dim_centro_unidade (
  centro  TEXT PRIMARY KEY,
  unidade TEXT NOT NULL
);

COMMENT ON TABLE public.dim_centro_unidade IS
  'Mapeamento de código de centro SAP para nome de unidade/loja.';

-- ------------------------------------------------------------
-- nota_acompanhamentos
-- Histórico de responsáveis que já acompanharam cada nota
-- ------------------------------------------------------------
CREATE TABLE public.nota_acompanhamentos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id        UUID        NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  administrador_id UUID      NOT NULL REFERENCES public.administradores(id) ON DELETE CASCADE,
  origem         TEXT        NOT NULL DEFAULT 'reatribuicao',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_nota_acompanhamentos_nota_admin UNIQUE (nota_id, administrador_id)
);

COMMENT ON TABLE public.nota_acompanhamentos IS
  'Registro de todos os admins que já foram responsáveis por uma nota.';

-- ------------------------------------------------------------
-- ordens_notas_acompanhamento
-- Ordens vinculadas a notas (PMOS) e ordens standalone (PMPL)
-- ------------------------------------------------------------
CREATE TABLE public.ordens_notas_acompanhamento (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id             UUID        REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  numero_nota         TEXT,
  ordem_codigo        TEXT        NOT NULL,
  administrador_id    UUID        REFERENCES public.administradores(id),
  centro              TEXT,
  unidade             TEXT,
  tipo_ordem          TEXT,
  status_ordem        public.ordem_status_acomp NOT NULL DEFAULT 'aberta',
  status_ordem_raw    TEXT,
  data_entrada        TIMESTAMPTZ,
  ordem_detectada_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_atualizado_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  sync_id             UUID        REFERENCES public.sync_log(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ordens_notas_acompanhamento_codigo UNIQUE (ordem_codigo)
);

CREATE TRIGGER trg_ordens_notas_acompanhamento_updated
  BEFORE UPDATE ON public.ordens_notas_acompanhamento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.ordens_notas_acompanhamento IS
  'Cockpit de ordens: vinculadas a notas (PMOS) e standalone (PMPL, nota_id NULL).';
COMMENT ON COLUMN public.ordens_notas_acompanhamento.nota_id IS
  'Nota de origem. NULL para ordens PMPL importadas sem nota correspondente.';
COMMENT ON COLUMN public.ordens_notas_acompanhamento.data_entrada IS
  'Data real de entrada da ordem no sistema de origem (preferencial: PMPL DATA_ENTRADA).';

-- ------------------------------------------------------------
-- ordens_notas_historico
-- Histórico de mudanças de status das ordens
-- ------------------------------------------------------------
CREATE TABLE public.ordens_notas_historico (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_id        UUID        NOT NULL REFERENCES public.ordens_notas_acompanhamento(id) ON DELETE CASCADE,
  status_anterior public.ordem_status_acomp,
  status_novo     public.ordem_status_acomp NOT NULL,
  status_raw      TEXT,
  origem          TEXT        NOT NULL,
  sync_id         UUID        REFERENCES public.sync_log(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ordens_notas_historico IS
  'Histórico de transições de status das ordens de acompanhamento.';

-- ------------------------------------------------------------
-- responsaveis_tipo_ordem
-- Responsável fixo por tipo de ordem (PMPL/PMOS)
-- ------------------------------------------------------------
CREATE TABLE public.responsaveis_tipo_ordem (
  tipo_ordem     TEXT        PRIMARY KEY CHECK (tipo_ordem IN ('PMPL', 'PMOS')),
  responsavel_id UUID        NOT NULL REFERENCES public.administradores(id) ON DELETE RESTRICT,
  substituto_id  UUID        REFERENCES public.administradores(id) ON DELETE SET NULL,
  atualizado_por UUID        REFERENCES public.administradores(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_responsavel_substituto_diferentes
    CHECK (substituto_id IS NULL OR substituto_id <> responsavel_id)
);

CREATE TRIGGER trg_responsaveis_tipo_ordem_updated
  BEFORE UPDATE ON public.responsaveis_tipo_ordem
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.responsaveis_tipo_ordem IS
  'Configuração de responsável fixo por tipo de ordem (PMPL/PMOS).';

-- ------------------------------------------------------------
-- auditoria_config
-- Auditoria de mudanças em configurações do sistema
-- ------------------------------------------------------------
CREATE TABLE public.auditoria_config (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         TEXT        NOT NULL,
  antes        JSONB,
  depois       JSONB,
  atualizado_por UUID      REFERENCES public.administradores(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auditoria_config IS
  'Auditoria de alterações em configurações operacionais do cockpit.';

-- ------------------------------------------------------------
-- ordens_tipo_documento_referencia
-- Tipo de documento SAP por código de ordem (mestre_dados_ordem)
-- ------------------------------------------------------------
CREATE TABLE public.ordens_tipo_documento_referencia (
  ordem_codigo_norm      TEXT        PRIMARY KEY,
  ordem_codigo_original  TEXT        NOT NULL,
  tipo_documento_vendas  TEXT        NOT NULL CHECK (tipo_documento_vendas IN ('PMOS', 'PMPL')),
  fonte                  TEXT        NOT NULL DEFAULT 'manutencao.silver.mestre_dados_ordem',
  last_sync_id           UUID        REFERENCES public.sync_log(id),
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ordens_tipo_doc_ref_updated
  BEFORE UPDATE ON public.ordens_tipo_documento_referencia
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.ordens_tipo_documento_referencia IS
  'Referência de tipo de ordem (PMOS/PMPL) por código normalizado, fonte mestre_dados_ordem.';

-- ------------------------------------------------------------
-- ordens_manutencao_referencia
-- Snapshot de ordens da fonte selecao_ordens_manutencao
-- ------------------------------------------------------------
CREATE TABLE public.ordens_manutencao_referencia (
  ordem_codigo_norm      TEXT        PRIMARY KEY,
  ordem_codigo_original  TEXT        NOT NULL,
  numero_nota_norm       TEXT,
  numero_nota_original   TEXT,
  tipo_ordem             TEXT        CHECK (tipo_ordem IN ('PMOS', 'PMPL')),
  texto_breve            TEXT,
  centro_liberacao       TEXT,
  data_extracao          TIMESTAMPTZ,
  fonte                  TEXT        NOT NULL DEFAULT 'manutencao.silver.selecao_ordens_manutencao',
  last_sync_id           UUID        REFERENCES public.sync_log(id),
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ordens_manut_ref_updated
  BEFORE UPDATE ON public.ordens_manutencao_referencia
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.ordens_manutencao_referencia IS
  'Referência de ordens SAP para enriquecer tipo_ordem, centro e texto_breve.';

-- ------------------------------------------------------------
-- sync_job_runtime_state
-- Estado de runtime do job de sincronização (streak de falhas, etc.)
-- ------------------------------------------------------------
CREATE TABLE public.sync_job_runtime_state (
  job_name                    TEXT        PRIMARY KEY,
  orders_ref_v2_failure_streak INTEGER    NOT NULL DEFAULT 0,
  last_error                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_sync_job_runtime_state_updated
  BEFORE UPDATE ON public.sync_job_runtime_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.sync_job_runtime_state IS
  'Estado em tempo de execução do job de sincronização.';

-- =============================================================
-- PARTE 4: ÍNDICES
-- =============================================================

-- notas_manutencao
CREATE INDEX idx_notas_manutencao_status          ON public.notas_manutencao (status);
CREATE INDEX idx_notas_manutencao_admin_id         ON public.notas_manutencao (administrador_id);
CREATE INDEX idx_notas_manutencao_data_criacao_sap ON public.notas_manutencao (data_criacao_sap DESC);
CREATE INDEX idx_notas_manutencao_updated_at       ON public.notas_manutencao (updated_at DESC);
CREATE INDEX idx_notas_manutencao_streaming_ts     ON public.notas_manutencao (streaming_timestamp DESC);
CREATE INDEX idx_notas_manutencao_ordem_sap_null   ON public.notas_manutencao (id)
  WHERE (ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000'));

-- notas_historico
CREATE INDEX idx_notas_historico_nota_id        ON public.notas_historico (nota_id);
CREATE INDEX idx_notas_historico_created_at     ON public.notas_historico (created_at DESC);
CREATE INDEX idx_notas_historico_alterado_por   ON public.notas_historico (alterado_por);

-- distribuicao_log
CREATE INDEX idx_distribuicao_log_nota_id    ON public.distribuicao_log (nota_id);
CREATE INDEX idx_distribuicao_log_admin_id   ON public.distribuicao_log (administrador_id);
CREATE INDEX idx_distribuicao_log_sync_id    ON public.distribuicao_log (sync_id);

-- admin_audit_log
CREATE INDEX idx_admin_audit_log_created_at  ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_alvo_id     ON public.admin_audit_log (alvo_id);
CREATE INDEX idx_admin_audit_log_gestor_id   ON public.admin_audit_log (gestor_id);

-- regras_distribuicao
CREATE INDEX idx_regras_especialidade ON public.regras_distribuicao (especialidade);

-- nota_acompanhamentos
CREATE INDEX idx_nota_acompanhamentos_nota  ON public.nota_acompanhamentos (nota_id);
CREATE INDEX idx_nota_acompanhamentos_admin ON public.nota_acompanhamentos (administrador_id);

-- ordens_notas_acompanhamento
CREATE INDEX idx_ordens_notas_acompanhamento_nota       ON public.ordens_notas_acompanhamento (nota_id);
CREATE INDEX idx_ordens_notas_acompanhamento_admin      ON public.ordens_notas_acompanhamento (administrador_id);
CREATE INDEX idx_ordens_notas_acompanhamento_status     ON public.ordens_notas_acompanhamento (status_ordem);
CREATE INDEX idx_ordens_notas_acompanhamento_detectada  ON public.ordens_notas_acompanhamento (ordem_detectada_em DESC);
CREATE INDEX idx_ordens_notas_acompanhamento_sync_id    ON public.ordens_notas_acompanhamento (sync_id);
CREATE INDEX idx_ordens_nota_id_status_ativo            ON public.ordens_notas_acompanhamento (nota_id)
  WHERE status_ordem NOT IN ('concluida', 'cancelada');

-- ordens_notas_historico
CREATE INDEX idx_ordens_notas_historico_ordem      ON public.ordens_notas_historico (ordem_id);
CREATE INDEX idx_ordens_notas_historico_created_at ON public.ordens_notas_historico (created_at DESC);
CREATE INDEX idx_ordens_notas_historico_sync_id    ON public.ordens_notas_historico (sync_id);

-- responsaveis_tipo_ordem
CREATE INDEX idx_responsaveis_tipo_ordem_responsavel  ON public.responsaveis_tipo_ordem (responsavel_id);
CREATE INDEX idx_responsaveis_tipo_ordem_substituto   ON public.responsaveis_tipo_ordem (substituto_id);
CREATE INDEX idx_responsaveis_tipo_ordem_atualizado_por ON public.responsaveis_tipo_ordem (atualizado_por);

-- auditoria_config
CREATE INDEX idx_auditoria_config_updated_at      ON public.auditoria_config (updated_at DESC);
CREATE INDEX idx_auditoria_config_atualizado_por  ON public.auditoria_config (atualizado_por);

-- ordens_tipo_documento_referencia
CREATE INDEX idx_ordens_tipo_doc_ref_tipo     ON public.ordens_tipo_documento_referencia (tipo_documento_vendas);
CREATE INDEX idx_ordens_tipo_doc_ref_updated  ON public.ordens_tipo_documento_referencia (updated_at DESC);
CREATE INDEX idx_ordens_tipo_doc_ref_sync_id  ON public.ordens_tipo_documento_referencia (last_sync_id);

-- ordens_manutencao_referencia
CREATE INDEX idx_ordens_manut_ref_tipo          ON public.ordens_manutencao_referencia (tipo_ordem);
CREATE INDEX idx_ordens_manut_ref_updated       ON public.ordens_manutencao_referencia (updated_at DESC);
CREATE INDEX idx_ordens_manut_ref_data_extracao ON public.ordens_manutencao_referencia (data_extracao DESC);
CREATE INDEX idx_ordens_manutencao_ref_sync_id  ON public.ordens_manutencao_referencia (last_sync_id);

-- sync_job_runtime_state
CREATE INDEX idx_sync_job_runtime_state_updated ON public.sync_job_runtime_state (updated_at DESC);

-- =============================================================
-- PARTE 5: ROW LEVEL SECURITY
-- =============================================================

-- administradores
ALTER TABLE public.administradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê administradores"
  ON public.administradores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor atualiza administradores"
  ON public.administradores FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- notas_manutencao
ALTER TABLE public.notas_manutencao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin vê suas notas, gestor vê tudo"
  ON public.notas_manutencao FOR SELECT TO authenticated
  USING (administrador_id = public.get_my_admin_id() OR public.get_my_role() = 'gestor');
CREATE POLICY "Admin atualiza suas notas, gestor atualiza tudo"
  ON public.notas_manutencao FOR UPDATE TO authenticated
  USING (administrador_id = public.get_my_admin_id() OR public.get_my_role() = 'gestor');
CREATE POLICY "Gestor insere notas"
  ON public.notas_manutencao FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'gestor');

-- notas_historico
ALTER TABLE public.notas_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin vê histórico de suas notas, gestor vê tudo"
  ON public.notas_historico FOR SELECT TO authenticated
  USING (
    nota_id IN (SELECT id FROM public.notas_manutencao WHERE administrador_id = public.get_my_admin_id())
    OR public.get_my_role() = 'gestor'
  );

-- sync_log
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor vê sync log"
  ON public.sync_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'gestor');

-- distribuicao_log
ALTER TABLE public.distribuicao_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor vê log de distribuição"
  ON public.distribuicao_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'gestor');

-- admin_audit_log
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor vê audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'gestor');

-- regras_distribuicao
ALTER TABLE public.regras_distribuicao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê regras de distribuição"
  ON public.regras_distribuicao FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor edita regras de distribuição"
  ON public.regras_distribuicao FOR ALL TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- dim_centro_unidade
ALTER TABLE public.dim_centro_unidade ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê centros"
  ON public.dim_centro_unidade FOR SELECT TO authenticated USING (true);

-- nota_acompanhamentos
ALTER TABLE public.nota_acompanhamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê acompanhamentos de nota"
  ON public.nota_acompanhamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor escreve acompanhamentos de nota"
  ON public.nota_acompanhamentos FOR ALL TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- ordens_notas_acompanhamento
ALTER TABLE public.ordens_notas_acompanhamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê ordens de acompanhamento"
  ON public.ordens_notas_acompanhamento FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor escreve ordens de acompanhamento"
  ON public.ordens_notas_acompanhamento FOR ALL TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- ordens_notas_historico
ALTER TABLE public.ordens_notas_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê histórico de ordens"
  ON public.ordens_notas_historico FOR SELECT TO authenticated USING (true);

-- responsaveis_tipo_ordem
ALTER TABLE public.responsaveis_tipo_ordem ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê responsáveis por tipo de ordem"
  ON public.responsaveis_tipo_ordem FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor edita responsáveis por tipo de ordem"
  ON public.responsaveis_tipo_ordem FOR ALL TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- auditoria_config
ALTER TABLE public.auditoria_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê auditoria de config"
  ON public.auditoria_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestor escreve auditoria de config"
  ON public.auditoria_config FOR ALL TO authenticated
  USING (public.get_my_role() = 'gestor') WITH CHECK (public.get_my_role() = 'gestor');

-- ordens_tipo_documento_referencia
ALTER TABLE public.ordens_tipo_documento_referencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê tipos de documento"
  ON public.ordens_tipo_documento_referencia FOR SELECT TO authenticated USING (true);

-- ordens_manutencao_referencia
ALTER TABLE public.ordens_manutencao_referencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê ordens de referência"
  ON public.ordens_manutencao_referencia FOR SELECT TO authenticated USING (true);

-- sync_job_runtime_state
ALTER TABLE public.sync_job_runtime_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor vê estado do sync job"
  ON public.sync_job_runtime_state FOR SELECT TO authenticated
  USING (public.get_my_role() = 'gestor');

-- =============================================================
-- PARTE 6: FUNÇÕES DE NEGÓCIO (SECURITY DEFINER)
-- =============================================================

-- ------------------------------------------------------------
-- atualizar_status_nota
-- Transição de status com validação e auditoria
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_status_nota(
  p_nota_id             UUID,
  p_novo_status         public.nota_status,
  p_admin_id            UUID,
  p_ordem_gerada        TEXT    DEFAULT NULL,
  p_fornecedor_encaminhado TEXT DEFAULT NULL,
  p_observacoes         TEXT    DEFAULT NULL,
  p_motivo              TEXT    DEFAULT NULL
)
RETURNS public.notas_manutencao
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota       public.notas_manutencao;
  v_old_status public.nota_status;
BEGIN
  SELECT * INTO v_nota FROM public.notas_manutencao WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota % não encontrada', p_nota_id; END IF;

  v_old_status := v_nota.status;

  IF NOT (
    (v_old_status = 'nova'                  AND p_novo_status IN ('em_andamento', 'cancelada'))
    OR (v_old_status = 'em_andamento'       AND p_novo_status IN ('encaminhada_fornecedor', 'concluida', 'cancelada'))
    OR (v_old_status = 'encaminhada_fornecedor' AND p_novo_status IN ('concluida', 'em_andamento', 'cancelada'))
  ) THEN
    RAISE EXCEPTION 'Transição de status inválida: % → %', v_old_status, p_novo_status;
  END IF;

  UPDATE public.notas_manutencao SET
    status                 = p_novo_status,
    ordem_gerada           = COALESCE(p_ordem_gerada, ordem_gerada),
    fornecedor_encaminhado = COALESCE(p_fornecedor_encaminhado, fornecedor_encaminhado),
    observacoes            = COALESCE(p_observacoes, observacoes),
    updated_at             = now()
  WHERE id = p_nota_id
  RETURNING * INTO v_nota;

  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
  VALUES (p_nota_id, 'status', v_old_status::TEXT, p_novo_status::TEXT, p_admin_id, p_motivo);

  RETURN v_nota;
END;
$$;

-- ------------------------------------------------------------
-- distribuir_notas
-- Distribui notas novas sem ordem entre admins ativos (menor carga primeiro)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_nota        RECORD;
  v_admin       RECORD;
  v_especialidade TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NULL
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    IF v_especialidade IS NULL THEN v_especialidade := 'geral'; END IF;

    SELECT a.id,
      COUNT(n.id) FILTER (WHERE n.status IN ('nova','em_andamento','encaminhada_fornecedor'))::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
    WHERE a.ativo = true AND a.recebe_distribuicao = true AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.max_notas
    HAVING COUNT(n.id) FILTER (WHERE n.status IN ('nova','em_andamento','encaminhada_fornecedor')) < a.max_notas
    ORDER BY open_count ASC, a.id ASC LIMIT 1;

    IF v_admin IS NULL AND v_especialidade <> 'geral' THEN
      SELECT a.id,
        COUNT(n.id) FILTER (WHERE n.status IN ('nova','em_andamento','encaminhada_fornecedor'))::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
      WHERE a.ativo = true AND a.recebe_distribuicao = true AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.max_notas
      HAVING COUNT(n.id) FILTER (WHERE n.status IN ('nova','em_andamento','encaminhada_fornecedor')) < a.max_notas
      ORDER BY open_count ASC, a.id ASC LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN EXIT; END IF;

    UPDATE public.notas_manutencao SET
      administrador_id = v_admin.id, distribuida_em = now(), updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (v_nota.id, 'administrador_id', NULL, v_admin.id::TEXT,
      'Distribuição automática (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual'));

    nota_id := v_nota.id; administrador_id := v_admin.id; notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- reatribuir_nota
-- Gestor move nota de um admin para outro com auditoria
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reatribuir_nota(
  p_nota_id       UUID,
  p_novo_admin_id UUID,
  p_gestor_id     UUID,
  p_motivo        TEXT DEFAULT NULL
)
RETURNS public.notas_manutencao
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota        public.notas_manutencao;
  v_old_admin_id UUID;
BEGIN
  PERFORM 1 FROM public.administradores WHERE id = p_gestor_id AND role = 'gestor' AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gestor inválido'; END IF;

  SELECT * INTO v_nota FROM public.notas_manutencao WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota % não encontrada', p_nota_id; END IF;

  v_old_admin_id := v_nota.administrador_id;
  IF v_old_admin_id IS NOT NULL AND v_old_admin_id = p_novo_admin_id THEN
    RAISE EXCEPTION 'Novo responsável deve ser diferente do atual';
  END IF;

  PERFORM 1 FROM public.administradores
  WHERE id = p_novo_admin_id AND role = 'admin' AND ativo = true AND em_ferias = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admin destino inválido (inativo ou em férias)'; END IF;

  UPDATE public.notas_manutencao SET
    administrador_id = p_novo_admin_id, distribuida_em = now(), updated_at = now()
  WHERE id = p_nota_id RETURNING * INTO v_nota;

  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
  VALUES (p_nota_id, 'administrador_id', COALESCE(v_old_admin_id::TEXT, 'NULL'),
    p_novo_admin_id::TEXT, p_gestor_id, COALESCE(p_motivo, 'Reatribuição manual pelo gestor'));

  IF v_old_admin_id IS NOT NULL THEN
    INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
    VALUES (p_nota_id, v_old_admin_id, 'reatribuicao')
    ON CONFLICT (nota_id, administrador_id) DO NOTHING;
  END IF;

  RETURN v_nota;
END;
$$;

-- ------------------------------------------------------------
-- reatribuir_notas_lote
-- Gestor redistribui todas as notas de um admin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reatribuir_notas_lote(
  p_admin_origem  UUID,
  p_gestor_id     UUID,
  p_modo          TEXT,
  p_admin_destino UUID DEFAULT NULL,
  p_motivo        TEXT DEFAULT NULL
)
RETURNS TABLE(nota_id UUID, administrador_destino_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_destinos       UUID[];
  v_destinos_count INTEGER;
  v_rr_index       INTEGER := 1;
  v_nota           RECORD;
  v_destino        UUID;
BEGIN
  PERFORM 1 FROM public.administradores WHERE id = p_gestor_id AND role = 'gestor' AND ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gestor inválido'; END IF;
  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido: use destino_unico ou round_robin';
  END IF;

  IF p_modo = 'destino_unico' THEN
    IF p_admin_destino IS NULL THEN RAISE EXCEPTION 'Destino obrigatório para destino_unico'; END IF;
    PERFORM 1 FROM public.administradores
    WHERE id = p_admin_destino AND role = 'admin' AND ativo = true AND em_ferias = false AND id <> p_admin_origem;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin destino inválido'; END IF;
  ELSE
    SELECT array_agg(a.id ORDER BY a.id) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin' AND a.ativo = true AND a.em_ferias = false AND a.id <> p_admin_origem;
    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);
    IF v_destinos_count = 0 THEN RAISE EXCEPTION 'Sem destinos elegíveis para round_robin'; END IF;
  END IF;

  FOR v_nota IN
    SELECT nm.id, nm.administrador_id FROM public.notas_manutencao nm
    WHERE nm.administrador_id = p_admin_origem AND nm.status IN ('nova','em_andamento','encaminhada_fornecedor')
    ORDER BY COALESCE(nm.data_criacao_sap::TIMESTAMP, nm.created_at), nm.created_at
    FOR UPDATE
  LOOP
    v_destino := CASE WHEN p_modo = 'destino_unico' THEN p_admin_destino
                      ELSE v_destinos[v_rr_index] END;
    IF p_modo = 'round_robin' THEN v_rr_index := (v_rr_index % v_destinos_count) + 1; END IF;

    UPDATE public.notas_manutencao SET
      administrador_id = v_destino, distribuida_em = now(), updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
    VALUES (v_nota.id, 'administrador_id', v_nota.administrador_id::TEXT, v_destino::TEXT, p_gestor_id,
      COALESCE(p_motivo, 'Reatribuição em lote (' || p_modo || ')'));

    IF v_nota.administrador_id IS NOT NULL THEN
      INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
      VALUES (v_nota.id, v_nota.administrador_id, 'reatribuicao')
      ON CONFLICT (nota_id, administrador_id) DO NOTHING;
    END IF;

    nota_id := v_nota.id; administrador_destino_id := v_destino; RETURN NEXT;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- registrar_ordens_por_notas
-- Detecta ordens SAP em notas e popula ordens_notas_acompanhamento
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id UUID)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota           RECORD;
  v_ordem          public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo   TEXT;
  v_unidade        TEXT;
  v_dias_para_gerar INTEGER;
  v_detectadas     INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
BEGIN
  FOR v_nota IN
    SELECT n.id, n.numero_nota, n.administrador_id, n.centro, n.status,
      n.data_criacao_sap, n.created_at, n.ordem_sap, n.ordem_gerada,
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (o.id IS NULL OR o.nota_id IS DISTINCT FROM n.id OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR n.status IN ('nova','em_andamento','encaminhada_fornecedor') OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = '')
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;
    SELECT d.unidade INTO v_unidade FROM public.dim_centro_unidade d WHERE d.centro = COALESCE(v_nota.centro, '');
    SELECT * INTO v_ordem FROM public.ordens_notas_acompanhamento o WHERE o.ordem_codigo = v_ordem_codigo FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST((current_date - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)), 0);
      INSERT INTO public.ordens_notas_acompanhamento
        (nota_id, numero_nota, ordem_codigo, administrador_id, centro, unidade, status_ordem, status_ordem_raw,
         ordem_detectada_em, status_atualizado_em, dias_para_gerar_ordem, sync_id)
      VALUES (v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_nota.administrador_id, v_nota.centro, v_unidade,
        'aberta', 'ABERTO', now(), now(), v_dias_para_gerar, p_sync_id)
      RETURNING * INTO v_ordem;
      INSERT INTO public.ordens_notas_historico (ordem_id, status_anterior, status_novo, status_raw, origem, sync_id)
      VALUES (v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id);
      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento SET
        nota_id = v_nota.id, numero_nota = v_nota.numero_nota,
        administrador_id = COALESCE(v_nota.administrador_id, ordens_notas_acompanhamento.administrador_id),
        centro = COALESCE(v_nota.centro, ordens_notas_acompanhamento.centro),
        unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
        sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id), updated_at = now()
      WHERE id = v_ordem.id;
    END IF;

    UPDATE public.notas_manutencao SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo), updated_at = now()
    WHERE id = v_nota.id AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

    IF v_nota.status IN ('nova','em_andamento','encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao SET status = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo), updated_at = now()
      WHERE id = v_nota.id;
      INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
      VALUES (v_nota.id, 'status', v_nota.status::TEXT, 'concluida', 'Auto conclusão: ordem identificada no sync');
      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_detectadas, v_auto_concluidas;
END;
$$;

-- ------------------------------------------------------------
-- atualizar_status_ordens_pmpl_lote
-- Atualiza status de ordens a partir de payload PMPL (batch)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_status_ordens_pmpl_lote(
  p_updates JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, ordens_atualizadas INTEGER, mudancas_status INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item         JSONB;
  v_ordem        public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_status_raw   TEXT;
  v_status_novo  public.ordem_status_acomp;
  v_centro       TEXT;
  v_unidade      TEXT;
  v_data_entrada_raw TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem   TEXT;
  v_total        INTEGER := 0;
  v_atualizadas  INTEGER := 0;
  v_mudancas     INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0; RETURN;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN CONTINUE; END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo := public.normalizar_status_ordem(v_status_raw);
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_data_entrada_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    v_tipo_ordem := NULLIF(BTRIM(v_item ->> 'tipo_ordem'), '');

    IF v_data_entrada_raw IS NOT NULL THEN
      BEGIN v_data_entrada := v_data_entrada_raw::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN v_data_entrada := NULL; END;
    END IF;

    SELECT * INTO v_ordem FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade FROM public.dim_centro_unidade d WHERE d.centro = v_centro;
    ELSE v_unidade := NULL; END IF;

    UPDATE public.ordens_notas_acompanhamento SET
      status_ordem = v_status_novo,
      status_ordem_raw = COALESCE(v_status_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(v_centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
      data_entrada = CASE WHEN v_data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN v_data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, v_data_entrada) END,
      tipo_ordem = COALESCE(v_tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id), updated_at = now()
    WHERE id = v_ordem.id;
    v_atualizadas := v_atualizadas + 1;

    IF v_ordem.status_ordem IS DISTINCT FROM v_status_novo THEN
      INSERT INTO public.ordens_notas_historico (ordem_id, status_anterior, status_novo, status_raw, origem, sync_id)
      VALUES (v_ordem.id, v_ordem.status_ordem, v_status_novo, v_status_raw, 'pmpl_sync', p_sync_id);
      v_mudancas := v_mudancas + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_total, v_atualizadas, v_mudancas;
END;
$$;

-- ------------------------------------------------------------
-- importar_ordens_pmpl_standalone
-- Upsert de ordens PMPL sem nota correspondente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders  JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item         JSONB;
  v_ordem_codigo TEXT;
  v_status_raw   TEXT;
  v_status_novo  public.ordem_status_acomp;
  v_centro       TEXT;
  v_unidade      TEXT;
  v_data_raw     TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem   TEXT;
  v_exists       BOOLEAN;
  v_total        INTEGER := 0;
  v_inseridas    INTEGER := 0;
  v_atualizadas  INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0; RETURN;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN CONTINUE; END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo := public.normalizar_status_ordem(v_status_raw);
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_tipo_ordem := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_data_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN v_data_entrada := NULL; END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade FROM public.dim_centro_unidade d WHERE d.centro = v_centro;
    ELSE v_unidade := NULL; END IF;

    SELECT EXISTS(SELECT 1 FROM public.ordens_notas_acompanhamento WHERE ordem_codigo = v_ordem_codigo) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento
      (nota_id, ordem_codigo, status_ordem, status_ordem_raw, centro, unidade, data_entrada, tipo_ordem, sync_id, ordem_detectada_em)
    VALUES (NULL, v_ordem_codigo, v_status_novo, v_status_raw, v_centro, v_unidade, v_data_entrada, v_tipo_ordem,
      p_sync_id, COALESCE(v_data_entrada, now()))
    ON CONFLICT (ordem_codigo) DO UPDATE SET
      status_ordem = EXCLUDED.status_ordem,
      status_ordem_raw = COALESCE(EXCLUDED.status_ordem_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(EXCLUDED.centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(EXCLUDED.unidade, ordens_notas_acompanhamento.unidade),
      data_entrada = CASE WHEN EXCLUDED.data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada) END,
      tipo_ordem = COALESCE(EXCLUDED.tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id = COALESCE(EXCLUDED.sync_id, ordens_notas_acompanhamento.sync_id), updated_at = now();

    IF v_exists THEN v_atualizadas := v_atualizadas + 1; ELSE v_inseridas := v_inseridas + 1; END IF;
  END LOOP;
  RETURN QUERY SELECT v_total, v_inseridas, v_atualizadas;
END;
$$;

-- ------------------------------------------------------------
-- enriquecer_ordens_por_referencia_manutencao
-- Enriquece tipo_ordem, centro, numero_nota via tabela de referência
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enriquecer_ordens_por_referencia_manutencao()
RETURNS TABLE(ordens_atualizadas_total INTEGER, tipo_ordem_atualizadas INTEGER,
              centro_preenchidos INTEGER, numero_nota_preenchidas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ref AS (
    SELECT r.ordem_codigo_norm,
      NULLIF(BTRIM(r.tipo_ordem), '') AS tipo_ordem_ref,
      NULLIF(BTRIM(r.centro_liberacao), '') AS centro_ref,
      NULLIF(BTRIM(r.numero_nota_norm), '') AS numero_nota_ref
    FROM public.ordens_manutencao_referencia r
  ),
  candidatos AS (
    SELECT o.id,
      o.tipo_ordem AS tipo_old, o.centro AS centro_old, o.numero_nota AS nota_old,
      CASE WHEN ref.tipo_ordem_ref IS NOT NULL THEN ref.tipo_ordem_ref ELSE o.tipo_ordem END AS tipo_new,
      CASE WHEN o.centro IS NULL OR BTRIM(o.centro) = '' THEN ref.centro_ref ELSE o.centro END AS centro_new,
      CASE WHEN (o.numero_nota IS NULL OR BTRIM(o.numero_nota) = '') AND ref.numero_nota_ref IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.notas_manutencao n WHERE n.numero_nota = ref.numero_nota_ref)
           THEN ref.numero_nota_ref ELSE o.numero_nota END AS nota_new
    FROM public.ordens_notas_acompanhamento o
    JOIN ref ON ref.ordem_codigo_norm = o.ordem_codigo
  ),
  delta AS (
    SELECT c.id, c.tipo_new, c.centro_new, c.nota_new,
      (c.tipo_new IS DISTINCT FROM c.tipo_old) AS tipo_changed,
      (c.centro_new IS DISTINCT FROM c.centro_old) AS centro_changed,
      (c.nota_new IS DISTINCT FROM c.nota_old) AS nota_changed
    FROM candidatos c
    WHERE c.tipo_new IS DISTINCT FROM c.tipo_old
       OR c.centro_new IS DISTINCT FROM c.centro_old
       OR c.nota_new IS DISTINCT FROM c.nota_old
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o SET
      tipo_ordem = d.tipo_new, centro = d.centro_new, numero_nota = d.nota_new,
      unidade = CASE WHEN d.centro_new IS NULL OR BTRIM(d.centro_new) = '' THEN o.unidade
                     ELSE COALESCE(du.unidade, o.unidade) END,
      updated_at = now()
    FROM delta d LEFT JOIN public.dim_centro_unidade du ON du.centro = d.centro_new
    WHERE o.id = d.id
    RETURNING d.tipo_changed, d.centro_changed, d.nota_changed
  )
  SELECT COUNT(*)::INTEGER,
    COALESCE(SUM(CASE WHEN u.tipo_changed    THEN 1 ELSE 0 END), 0)::INTEGER,
    COALESCE(SUM(CASE WHEN u.centro_changed  THEN 1 ELSE 0 END), 0)::INTEGER,
    COALESCE(SUM(CASE WHEN u.nota_changed    THEN 1 ELSE 0 END), 0)::INTEGER
  FROM upd u;
END;
$$;

-- =============================================================
-- PARTE 7: VIEWS (SECURITY INVOKER — respeita RLS do chamador)
-- =============================================================

-- Carga por administrador (quantidade de notas por status)
CREATE OR REPLACE VIEW public.vw_carga_administradores
WITH (security_invoker = on) AS
SELECT
  a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url, a.especialidade,
  COUNT(n.id) FILTER (WHERE n.status = 'nova')                 AS qtd_nova,
  COUNT(n.id) FILTER (WHERE n.status = 'em_andamento')         AS qtd_em_andamento,
  COUNT(n.id) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
  COUNT(n.id) FILTER (WHERE n.status IN ('nova','em_andamento','encaminhada_fornecedor')) AS qtd_abertas,
  COUNT(n.id) FILTER (WHERE n.status = 'concluida')            AS qtd_concluidas,
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada')            AS qtd_canceladas,
  a.recebe_distribuicao,
  a.em_ferias
FROM public.administradores a
LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url,
         a.especialidade, a.recebe_distribuicao, a.em_ferias;

-- Notas genuinamente sem ordem SAP e sem ordem ativa no cockpit
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem
WITH (security_invoker = on) AS
SELECT
  id, numero_nota, tipo_nota, descricao, descricao_objeto, prioridade, tipo_prioridade,
  criado_por_sap, solicitante, data_criacao_sap, data_nota, hora_nota, ordem_sap, centro,
  status_sap, conta_fornecedor, autor_nota, streaming_timestamp, status, administrador_id,
  distribuida_em, ordem_gerada, fornecedor_encaminhado, observacoes, sync_id, raw_data,
  created_at, updated_at
FROM public.notas_manutencao n
WHERE status = ANY (ARRAY['nova'::public.nota_status,'em_andamento'::public.nota_status,'encaminhada_fornecedor'::public.nota_status])
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1 FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id AND o.status_ordem NOT IN ('concluida','cancelada')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(ltrim(btrim(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND o.status_ordem NOT IN ('concluida','cancelada')
  );

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Notas abertas sem ordem SAP (ordem_sap IS NULL/vazio) e sem ordem ativa no cockpit.';

-- Painel de ordens com semáforo de atraso
CREATE OR REPLACE VIEW public.vw_ordens_notas_painel
WITH (security_invoker = on) AS
WITH historico AS (
  SELECT na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na GROUP BY na.nota_id
),
base AS (
  SELECT o.id AS ordem_id, o.nota_id, o.numero_nota, o.ordem_codigo, o.administrador_id,
    origem.nome AS administrador_nome,
    COALESCE(n.administrador_id, o.administrador_id) AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro, COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem, o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em, o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao, o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n       ON n.id = o.nota_id
  LEFT JOIN public.administradores origem   ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual    ON atual.id = COALESCE(n.administrador_id, o.administrador_id)
  LEFT JOIN public.dim_centro_unidade d     ON d.centro = o.centro
  LEFT JOIN historico h                     ON h.nota_id = o.nota_id
)
SELECT b.ordem_id, b.nota_id, b.numero_nota, b.ordem_codigo, b.administrador_id,
  b.administrador_nome, b.responsavel_atual_id, b.responsavel_atual_nome,
  b.centro, b.unidade, b.status_ordem, b.status_ordem_raw,
  b.ordem_detectada_em, b.status_atualizado_em, b.dias_para_gerar_ordem,
  b.qtd_historico, (b.qtd_historico > 0) AS tem_historico,
  CASE WHEN b.status_ordem IN ('concluida','cancelada') THEN 0
       ELSE GREATEST((current_date - b.ordem_detectada_em::date), 0) END::INTEGER AS dias_em_aberto,
  CASE WHEN b.status_ordem IN ('concluida','cancelada') THEN 'neutro'
       WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
       WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
       ELSE 'verde' END AS semaforo_atraso,
  ARRAY(SELECT DISTINCT x FROM unnest(b.historico_admin_ids || ARRAY[b.administrador_id, b.responsavel_atual_id]) AS x WHERE x IS NOT NULL) AS envolvidos_admin_ids,
  b.descricao, b.tipo_ordem
FROM base b;

-- =============================================================
-- PARTE 8: DADOS DE REFERÊNCIA (sem usuários específicos)
-- =============================================================

-- Centros SAP → Unidades/Lojas
INSERT INTO public.dim_centro_unidade (centro, unidade) VALUES
  ('101','MATRIZ'),('103','AVENIDA'),('104','CD MANAUS'),('105','EDUCANDOS'),
  ('106','AMAZONAS SHOPPING'),('109','GRANDE CIRCULAR'),('114','PONTA NEGRA'),
  ('115','CIDADE NOVA'),('116','SHOPPING STUDIO 5'),('117','SHOPPING MILLENNIUM'),
  ('118','CAMAPUA'),('119','SHOPPING MANAUARA'),('120','SHOPPING PONTA NEGRA'),
  ('121','NOVA CIDADE'),('144','CD II'),('148','CD TARUMA'),('149','CD FARMA TARUMA'),
  ('170','CD PORTO'),('201','PORTO VELHO CENTRO'),('202','SHOPPING PORTO VELHO'),
  ('203','CD PORTO VELHO'),('204','JATUARANA'),('205','JI-PARANA'),('206','ARIQUEMES'),
  ('401','RIO BRANCO'),('402','CD RIO BRANCO'),('404','CRUZEIRO DO SUL'),
  ('500','TORQUATO'),('510','ITACOATIARA'),('520','MANACAPURU'),
  ('530','PRESIDENTE FIGUEIREDO'),('531','AUTAZES'),('550','IRANDUBA'),
  ('560','RIO PRETO'),('561','CODAJAS'),('570','MANAQUIRI'),('580','CAREIRO'),
  ('590','PARINTINS'),('591','COARI'),('592','MAUES'),
  ('601','BEMOL FARMA TORQUATO'),('602','FARMA CAMAPUA'),
  ('603','BEMOL FARMA AMAZONAS SHOPPING'),('604','FARMA GRANDE CIRCULAR'),
  ('605','BEMOL FARMA MATRIZ'),('606','BEMOL FARMA SHOPPING PONTA NEGRA'),
  ('607','BEMOL FARMA NOVA CIDADE'),('609','FARMA PORTO VELHO'),
  ('610','FARMA BOA VISTA'),('611','FARMA ITACOATIARA'),('612','FARMA MANAUARA'),
  ('613','FARMA ARIQUEMES'),('614','BEMOL FARMA PRESIDENTE FIGUEIREDO'),
  ('615','FARMA DJALMA'),('616','FARMA JI-PARANA'),('617','FARMA PONTA NEGRA DB'),
  ('618','FARMA STUDIO 5'),('619','FARMA JATUARANA'),('620','FARMA AVENIDA'),
  ('621','FARMA CIDADE NOVA'),('622','FARMA AUTAZES'),('623','FARMA ATAIDE TEIVE'),
  ('624','FARMA MANACAPURU'),('625','FARMA RIO BRANCO'),('626','FARMA RORAINOPOLIS'),
  ('627','FARMA GETULIO VARGAS'),('628','FARMA EDUARDO GOMES'),('629','FARMA RIO PRETO'),
  ('630','FARMA CODAJAS'),('631','FARMA PORTO VELHO SHOPPING'),
  ('632','FARMA CRUZEIRO DO SUL'),('633','FARMA MANAQUIRI'),('634','FARMA MAJOR WILLIAMS'),
  ('635','FARMA CAREIRO'),('636','FARMA DOM PEDRO'),('637','FARMA BOULEVARD'),
  ('638','BEMOL FARMA IRANDUBA'),('639','BEMOL FARMA PARINTINS'),
  ('640','BEMOL FARMA COARI'),('641','BEMOL FARMA EDUCANDOS'),
  ('642','FARMA VIA NORTE'),('643','FARMA EFIGENIO SALLES'),('644','FARMA FRANCESES'),
  ('645','FARMA COROADO'),('647','FARMA AV. DAS TORRES'),('648','FARMA NOEL NUTELS'),
  ('649','FARMA FLORES'),('699','FARMA TORRES ONLINE'),
  ('701','SHOPPING BOA VISTA'),('702','ATAIDE TEIVE'),('703','RORAINOPOLIS'),
  ('704','CD BOA VISTA'),('705','GETULIO VARGAS'),('706','MAJOR WILLIAMS')
ON CONFLICT (centro) DO UPDATE SET unidade = EXCLUDED.unidade;

-- Regras de distribuição por especialidade (palavras-chave em descricao da nota)
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade) VALUES
  -- Refrigeração
  ('AR CONDICIONADO (ATE 60.000 BTUS)',        'refrigeracao'),
  ('AR CONDICIONADO (VRF/CHILLER/SPLITAO)',     'refrigeracao'),
  ('MANUT.PREVENTIVA CENTRAIS DE AR',          'refrigeracao'),
  ('MANUTENCAO PREVENTIVA LIMPEZA AR-COND',    'refrigeracao'),
  ('CORRETIVA DO AR-CONDICIONADO',             'refrigeracao'),
  ('PREVENTIVA DO AR-CONDICONADO',             'refrigeracao'),
  ('AR CONDICIONADO',                          'refrigeracao'),
  ('AR-CONDICIONADO',                          'refrigeracao'),
  ('AR-COND',                                  'refrigeracao'),
  ('CENTRAIS DE AR',                           'refrigeracao'),
  ('CHILLER',                                  'refrigeracao'),
  ('VRF',                                      'refrigeracao'),
  ('SPLITAO',                                  'refrigeracao'),
  ('FREEZER',                                  'refrigeracao'),
  ('GELADEIRA',                                'refrigeracao'),
  ('TERMOMETRO DE GELADEIRA',                  'refrigeracao'),
  ('REFRIGERACAO',                             'refrigeracao'),
  ('BTUS',                                     'refrigeracao'),
  -- Elevadores / Críticos
  ('ELEVADOR',                                 'elevadores'),
  ('MANUT. PREVENTIVA/CORRET. NO ELEVADOR',    'elevadores'),
  ('ESCADA ROLANTE',                           'elevadores'),
  ('MANUT-PREVENTIVA ESCADA ROLANTE',          'elevadores'),
  ('SUBESTACAO',                               'elevadores'),
  ('GERADOR',                                  'elevadores'),
  ('GRUPO GERADOR',                            'elevadores'),
  ('MANUT. PREVENT-GRUPO GERADOR',             'elevadores'),
  ('MANUT.PREVENTIVA GRUPO GERADOR',           'elevadores'),
  ('MONTA CARGA',                              'elevadores'),
  ('MANUT. PREVENTIVA NO MONTA CARGA',         'elevadores'),
  ('MANUT. PREVENTIVA DA PLATAFORMA',          'elevadores'),
  ('PLATAFORMA',                               'elevadores');
