-- 00080_hardening_rls_search_path_fk_indexes.sql
--
-- Migration de hardening para projeto compartilhado.
-- Consolida todas as correções de segurança e performance apontadas pelo Supabase Advisor.
--
-- Mudanças:
--   Parte 1 — ENABLE ROW LEVEL SECURITY nas 6 tabelas com policies já criadas
--   Parte 2 — ENABLE RLS + policies mínimas nas 9 tabelas sem proteção
--   Parte 3 — SECURITY INVOKER em todas as 19 views (eram SECURITY DEFINER)
--   Parte 4 — SET search_path = public nas funções de negócio (14 SECURITY DEFINER + 12 normais)
--   Parte 5 — Índices para os 15 FKs sem cobertura
--
-- Impacto por role:
--   anon            → zero acesso (RLS bloqueia por padrão)
--   authenticated admin  → vê apenas seus dados (filtrado por get_my_admin_id())
--   authenticated gestor → vê tudo (get_my_role() = 'gestor' libera)
--   service_role (jobs)  → bypass automático de RLS, sem impacto
--
-- Views SECURITY INVOKER: a query executa com permissões do usuário chamador,
-- respeitando o RLS das tabelas subjacentes. Gestors continuam vendo tudo.

-- ============================================================
-- PARTE 1: Habilitar RLS nas tabelas com policies já criadas
-- As policies existem mas estavam inativas — só requer o ENABLE.
-- ============================================================

ALTER TABLE public.administradores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribuicao_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_historico      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_manutencao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_distribuicao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log             ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PARTE 2: Habilitar RLS + criar policies nas tabelas sem proteção
-- Princípio: anon bloqueado; service_role bypassa automaticamente.
-- ============================================================

-- admin_audit_log: trilha de auditoria de ações de gestores
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor ve audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (get_my_role() = 'gestor'::user_role);

-- dim_centro_unidade: dados de referência (mapeamento centro → unidade)
ALTER TABLE public.dim_centro_unidade ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê centros"
  ON public.dim_centro_unidade FOR SELECT TO authenticated
  USING (true);

-- nota_acompanhamentos: histórico de acompanhamento de notas
ALTER TABLE public.nota_acompanhamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê acompanhamentos de nota"
  ON public.nota_acompanhamentos FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Gestor escreve acompanhamentos de nota"
  ON public.nota_acompanhamentos FOR ALL TO authenticated
  USING    (get_my_role() = 'gestor'::user_role)
  WITH CHECK (get_my_role() = 'gestor'::user_role);

-- notas_convergencia_cockpit: dados internos de convergência (Databricks)
-- Somente gestors veem; jobs escrevem via service_role (bypass automático).
ALTER TABLE public.notas_convergencia_cockpit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor ve convergencia cockpit"
  ON public.notas_convergencia_cockpit FOR SELECT TO authenticated
  USING (get_my_role() = 'gestor'::user_role);

-- ordens_manutencao_referencia: ordens SAP de referência (snapshot)
ALTER TABLE public.ordens_manutencao_referencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê ordens referencia manutencao"
  ON public.ordens_manutencao_referencia FOR SELECT TO authenticated
  USING (true);

-- ordens_notas_acompanhamento: cockpit de ordens vinculadas a notas
-- Leitura: todos autenticados (ordens não são dados pessoais sensíveis)
-- Escrita: gestors (admins escrevem via funções SECURITY DEFINER)
ALTER TABLE public.ordens_notas_acompanhamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê ordens de acompanhamento"
  ON public.ordens_notas_acompanhamento FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Gestor escreve ordens de acompanhamento"
  ON public.ordens_notas_acompanhamento FOR ALL TO authenticated
  USING    (get_my_role() = 'gestor'::user_role)
  WITH CHECK (get_my_role() = 'gestor'::user_role);

-- ordens_notas_historico: histórico de mudanças de status das ordens
ALTER TABLE public.ordens_notas_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê historico de ordens"
  ON public.ordens_notas_historico FOR SELECT TO authenticated
  USING (true);

-- ordens_tipo_documento_referencia: tipos de documento SAP (referência)
ALTER TABLE public.ordens_tipo_documento_referencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticado lê tipos de documento"
  ON public.ordens_tipo_documento_referencia FOR SELECT TO authenticated
  USING (true);

-- sync_job_runtime_state: estado interno do job de sincronização
ALTER TABLE public.sync_job_runtime_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestor ve estado do sync job"
  ON public.sync_job_runtime_state FOR SELECT TO authenticated
  USING (get_my_role() = 'gestor'::user_role);

-- ============================================================
-- PARTE 3: Converter views para SECURITY INVOKER
--
-- Views com SECURITY DEFINER executam com permissões do criador e
-- ignoram completamente o RLS das tabelas subjacentes.
-- SECURITY INVOKER faz a query executar com as permissões do
-- usuário chamador, respeitando o RLS de cada tabela.
-- ============================================================

ALTER VIEW public.vw_carga_administradores                     SET (security_invoker = on);
ALTER VIEW public.vw_carga_administradores_cockpit_convergidas  SET (security_invoker = on);
ALTER VIEW public.vw_dashboard_fluxo_diario_90d               SET (security_invoker = on);
ALTER VIEW public.vw_dashboard_produtividade_60d              SET (security_invoker = on);
ALTER VIEW public.vw_iso_global                               SET (security_invoker = on);
ALTER VIEW public.vw_iso_por_admin                            SET (security_invoker = on);
ALTER VIEW public.vw_notas_cockpit_convergidas                SET (security_invoker = on);
ALTER VIEW public.vw_notas_metrics_30d                        SET (security_invoker = on);
ALTER VIEW public.vw_notas_sem_ordem                          SET (security_invoker = on);
ALTER VIEW public.vw_ordens_acompanhamento                    SET (security_invoker = on);
ALTER VIEW public.vw_ordens_notas_kpis                        SET (security_invoker = on);
ALTER VIEW public.vw_ordens_notas_painel                      SET (security_invoker = on);
ALTER VIEW public.vw_ordens_notas_ranking_admin_30d           SET (security_invoker = on);
ALTER VIEW public.vw_ordens_notas_ranking_unidade_30d         SET (security_invoker = on);
ALTER VIEW public.vw_ordens_sem_nota_operacional              SET (security_invoker = on);
ALTER VIEW public.vw_perspectiva_reatribuicao_admin_30d       SET (security_invoker = on);
ALTER VIEW public.vw_produtividade_detalhada                  SET (security_invoker = on);
ALTER VIEW public.vw_produtividade_mensal                     SET (security_invoker = on);
ALTER VIEW public.vw_radar_colaborador                        SET (security_invoker = on);

-- ============================================================
-- PARTE 4: Corrigir search_path nas funções
--
-- Funções sem search_path fixo são vulneráveis a ataques de
-- search_path injection (um schema malicioso pode sobrepor funções).
-- SET search_path = public garante que a função sempre usa o schema correto.
--
-- Nota: funções da extensão pg_trgm (gin_*, gtrgm_*, similarity_*, etc.)
-- não são tocadas — são gerenciadas pelo Postgres internamente.
-- ============================================================

-- Funções SECURITY DEFINER (maior risco — executam com permissões elevadas)
ALTER FUNCTION public.get_my_admin_id()
  SET search_path = public;

ALTER FUNCTION public.get_my_role()
  SET search_path = public;

ALTER FUNCTION public.atribuir_responsavel_ordens_standalone()
  SET search_path = public;

ALTER FUNCTION public.atualizar_status_nota(
  uuid, nota_status, uuid, text, text, text, text
) SET search_path = public;

ALTER FUNCTION public.atualizar_status_ordens_pmpl_lote(jsonb, uuid)
  SET search_path = public;

ALTER FUNCTION public.distribuir_notas(uuid)
  SET search_path = public;

ALTER FUNCTION public.force_cockpit_convergence_recheck()
  SET search_path = public;

ALTER FUNCTION public.pick_fallback_admin_for_order(text)
  SET search_path = public;

ALTER FUNCTION public.realinhar_responsavel_pmpl_standalone()
  SET search_path = public;

ALTER FUNCTION public.reatribuir_nota(uuid, uuid, uuid, text)
  SET search_path = public;

ALTER FUNCTION public.reatribuir_notas_lote(uuid, uuid, text, uuid, text)
  SET search_path = public;

ALTER FUNCTION public.reatribuir_ordens_selecionadas(uuid[], uuid, text, uuid, text)
  SET search_path = public;

ALTER FUNCTION public.registrar_ordens_por_notas(uuid)
  SET search_path = public;

ALTER FUNCTION public.sync_ordem_admin_from_nota()
  SET search_path = public;

-- Funções de negócio (não-SECURITY DEFINER — menor risco, boa prática)
ALTER FUNCTION public.update_updated_at()
  SET search_path = public;

ALTER FUNCTION public.normalizar_centro_codigo(text)
  SET search_path = public;

ALTER FUNCTION public.normalizar_status_ordem(text)
  SET search_path = public;

ALTER FUNCTION public._is_avaliada(text)
  SET search_path = public;

ALTER FUNCTION public._is_em_avaliacao(text)
  SET search_path = public;

ALTER FUNCTION public._is_em_processamento(text)
  SET search_path = public;

ALTER FUNCTION public.enriquecer_ordens_por_referencia_manutencao()
  SET search_path = public;

ALTER FUNCTION public.enriquecer_tipo_ordem_por_referencia()
  SET search_path = public;

ALTER FUNCTION public.importar_ordens_pmpl_standalone(jsonb, uuid)
  SET search_path = public;

ALTER FUNCTION public.buscar_ordens_prioritarias_dashboard(
  timestamp with time zone,
  timestamp with time zone,
  integer,
  text
) SET search_path = public;

ALTER FUNCTION public.calcular_kpis_ordens(
  timestamp with time zone,
  timestamp with time zone,
  uuid, text, text, text
) SET search_path = public;

ALTER FUNCTION public.calcular_metricas_notas_dashboard(
  timestamp with time zone,
  timestamp with time zone
) SET search_path = public;

ALTER FUNCTION public.calcular_produtividade_notas_dashboard(
  timestamp with time zone,
  timestamp with time zone
) SET search_path = public;

ALTER FUNCTION public.calcular_ranking_ordens_admin(
  timestamp with time zone,
  timestamp with time zone,
  text
) SET search_path = public;

ALTER FUNCTION public.calcular_ranking_ordens_unidade(
  timestamp with time zone,
  timestamp with time zone,
  text
) SET search_path = public;

ALTER FUNCTION public.listar_fluxo_notas_dashboard(
  timestamp with time zone,
  timestamp with time zone
) SET search_path = public;

-- buscar_ordens_workspace: 15 parâmetros
ALTER FUNCTION public.buscar_ordens_workspace(
  text, integer, integer,
  timestamp with time zone, timestamp with time zone,
  text, text, text, text, text,
  uuid,
  timestamp with time zone, uuid,
  integer, text
) SET search_path = public;

-- calcular_kpis_ordens_operacional: 12 parâmetros
ALTER FUNCTION public.calcular_kpis_ordens_operacional(
  text, integer, integer,
  timestamp with time zone, timestamp with time zone,
  text, text, text, text, text,
  uuid, text
) SET search_path = public;

-- calcular_resumo_colaboradores_ordens: 12 parâmetros
ALTER FUNCTION public.calcular_resumo_colaboradores_ordens(
  text, integer, integer,
  timestamp with time zone, timestamp with time zone,
  text, text, text, text, text,
  uuid, text
) SET search_path = public;

-- filtrar_ordens_workspace: 12 parâmetros
ALTER FUNCTION public.filtrar_ordens_workspace(
  text, integer, integer,
  timestamp with time zone, timestamp with time zone,
  text, text, text, text, text,
  uuid, text
) SET search_path = public;

-- ============================================================
-- PARTE 5: Índices para FKs sem cobertura
-- Cada FK sem índice causa seq scan na tabela referenciada
-- em todo DELETE/UPDATE na tabela pai (cascata de verificação).
-- ============================================================

-- admin_audit_log
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_alvo_id
  ON public.admin_audit_log (alvo_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_gestor_id
  ON public.admin_audit_log (gestor_id);

-- auditoria_config
CREATE INDEX IF NOT EXISTS idx_auditoria_config_atualizado_por
  ON public.auditoria_config (atualizado_por);

-- distribuicao_log
CREATE INDEX IF NOT EXISTS idx_distribuicao_log_nota_id
  ON public.distribuicao_log (nota_id);
CREATE INDEX IF NOT EXISTS idx_distribuicao_log_sync_id
  ON public.distribuicao_log (sync_id);

-- notas_convergencia_cockpit
CREATE INDEX IF NOT EXISTS idx_notas_convergencia_administrador_id
  ON public.notas_convergencia_cockpit (administrador_id);
CREATE INDEX IF NOT EXISTS idx_notas_convergencia_nota_id
  ON public.notas_convergencia_cockpit (nota_id);
CREATE INDEX IF NOT EXISTS idx_notas_convergencia_sync_id
  ON public.notas_convergencia_cockpit (sync_id);

-- notas_historico
CREATE INDEX IF NOT EXISTS idx_notas_historico_alterado_por
  ON public.notas_historico (alterado_por);

-- notas_manutencao
CREATE INDEX IF NOT EXISTS idx_notas_manutencao_administrador_id
  ON public.notas_manutencao (administrador_id);

-- ordens_manutencao_referencia
CREATE INDEX IF NOT EXISTS idx_ordens_manutencao_ref_last_sync_id
  ON public.ordens_manutencao_referencia (last_sync_id);

-- ordens_notas_acompanhamento
CREATE INDEX IF NOT EXISTS idx_ordens_notas_acomp_sync_id
  ON public.ordens_notas_acompanhamento (sync_id);

-- ordens_notas_historico
CREATE INDEX IF NOT EXISTS idx_ordens_notas_historico_sync_id
  ON public.ordens_notas_historico (sync_id);

-- ordens_tipo_documento_referencia
CREATE INDEX IF NOT EXISTS idx_ordens_tipo_doc_ref_last_sync_id
  ON public.ordens_tipo_documento_referencia (last_sync_id);

-- responsaveis_tipo_ordem
CREATE INDEX IF NOT EXISTS idx_responsaveis_tipo_ordem_atualizado_por
  ON public.responsaveis_tipo_ordem (atualizado_por);
