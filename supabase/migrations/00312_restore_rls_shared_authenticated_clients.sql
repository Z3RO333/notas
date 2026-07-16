-- 00312_restore_rls_shared_authenticated_clients.sql
--
-- Reverte o DISABLE ROW LEVEL SECURITY da migration 00309.
--
-- O Cockpit novo usa service_role e continua ignorando RLS normalmente. Porém,
-- este projeto Supabase também autentica os clientes do rota-platform com o role
-- authenticated. Como authenticated ainda possui grants no schema public,
-- desabilitar RLS expôs acesso direto às tabelas fora da autorização do Cockpit.
-- Reabilitar as policies existentes fecha esse acesso sem afetar service_role.

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartao_corporativo_gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centros_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_intent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_centro_unidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_denominacao_norm ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribuicao_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_distribuicao_sabado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_distribuicao_sabado_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nota_acompanhamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_convergencia_cockpit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_manutencao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_operacao_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_status_sap_aux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_financeiro_importado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_manutencao_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_notas_acompanhamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_notas_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_tipo_documento_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_distribuicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsaveis_tipo_ordem ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_user_admin_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_job_runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
