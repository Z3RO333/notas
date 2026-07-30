-- 00322_administrador_emails_login_view.sql
--
-- Suporte a perfis administradores compartilhados: um administrador pode ser
-- acessado por múltiplos logins (emails). O email primário continua em
-- administradores.email (compatibilidade com todo código existente). Emails
-- adicionais ficam em administrador_emails. A view vw_administrador_por_email
-- unifica as duas fontes com as mesmas colunas de administradores, para que
-- qualquer lookup de "quem é esse email logado" troque .from('administradores')
-- por .from('vw_administrador_por_email') sem mudar o resto da query.

CREATE TABLE IF NOT EXISTS public.administrador_emails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  administrador_id UUID NOT NULL REFERENCES public.administradores(id) ON DELETE CASCADE,
  email            TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_administrador_emails_administrador_id
  ON public.administrador_emails (administrador_id);

CREATE OR REPLACE VIEW public.vw_administrador_por_email AS
SELECT
  a.id, a.auth_user_id, a.nome, a.email, a.role, a.ativo, a.max_notas,
  a.created_at, a.updated_at, a.avatar_url, a.especialidade,
  a.recebe_distribuicao, a.em_ferias, a.motivo_bloqueio,
  a.data_inicio_ferias, a.data_fim_ferias, a.meta_semanal, a.operacional_codigo
FROM public.administradores a
UNION ALL
SELECT
  a.id, a.auth_user_id, a.nome, ae.email, a.role, a.ativo, a.max_notas,
  a.created_at, a.updated_at, a.avatar_url, a.especialidade,
  a.recebe_distribuicao, a.em_ferias, a.motivo_bloqueio,
  a.data_inicio_ferias, a.data_fim_ferias, a.meta_semanal, a.operacional_codigo
FROM public.administrador_emails ae
JOIN public.administradores a ON a.id = ae.administrador_id;

COMMENT ON VIEW public.vw_administrador_por_email IS
  'Resolve o administrador dono de um login (email primário em administradores.email '
  'OU email adicional em administrador_emails), mesmas colunas de administradores. '
  'Usar no lugar de administradores em qualquer query que filtre por email de sessão.';
