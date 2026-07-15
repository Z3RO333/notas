-- 00309_disable_rls_service_role_only.sql
--
-- O notas migrou de Supabase Auth (login por senha) para Microsoft Entra ID
-- via NextAuth.js. A partir de agora, toda query do servidor usa a
-- service_role key (bypassa RLS por natureza) e a autorização é feita em
-- código (Next.js), não mais em RLS.
--
-- As policies abaixo dependiam de get_my_role()/get_my_admin_id(), que por
-- sua vez dependem de auth.uid() — e auth.uid() nunca mais retorna um valor
-- não-nulo, já que não existe mais sessão Supabase Auth de usuário. Deixar
-- RLS "ligado" nessas tabelas seria decorativo e enganoso (sugere uma
-- proteção que não está mais em vigor da forma como o código funciona).
--
-- anon já não tem nenhum grant nessas tabelas desde a migration 00305
-- (hardening), então desabilitar RLS aqui não abre acesso novo pra anon —
-- só remove uma camada de policy que nunca mais vai casar com nada.

ALTER TABLE public.admin_audit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.administradores DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartao_corporativo_gastos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.centros_pool DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_intent_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_centro_unidade DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_denominacao_norm DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_fornecedores DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_operacionais DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribuicao_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_distribuicao_sabado DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_distribuicao_sabado_participantes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.nota_acompanhamentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_convergencia_cockpit DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_historico DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_manutencao DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_operacao_estado DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_status_sap_aux DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_financeiro_importado DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_manutencao_referencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_notas_acompanhamento DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_notas_historico DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_tipo_documento_referencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_distribuicao DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsaveis_tipo_ordem DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_user_admin_map DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_job_runtime_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log DISABLE ROW LEVEL SECURITY;
