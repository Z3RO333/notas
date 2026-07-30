-- 00326_vw_administrador_por_email_prefer_primary.sql
--
-- Corrige achado da revisão final: se um email secundário em
-- administrador_emails coincidir com o email primário de OUTRO admin,
-- a view retornava 2 linhas (UNION ALL sem filtro), quebrando todo
-- .single()/.maybeSingle() que resolve identidade de login e travando
-- o dono legítimo do email primário fora do sistema. O email primário
-- sempre vence em caso de colisão.

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
JOIN public.administradores a ON a.id = ae.administrador_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.administradores p WHERE p.email = ae.email
);

COMMENT ON VIEW public.vw_administrador_por_email IS
  'Resolve o administrador dono de um login (email primário em administradores.email '
  'OU email adicional em administrador_emails), mesmas colunas de administradores. '
  'Usar no lugar de administradores em qualquer query que filtre por email de sessão. '
  'Email primário sempre vence em caso de colisão com um email secundário de outro admin (00326).';
