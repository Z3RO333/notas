-- 00084_restore_daniel_damasceno_gestor.sql
-- Daniel Damasceno foi removido da tabela administradores.
-- Reinsere com role=gestor, auth_user_id já vinculado ao login existente.

INSERT INTO public.administradores (nome, email, role, ativo, especialidade, max_notas, auth_user_id)
VALUES (
  'Daniel Damasceno',
  'danieldamasceno@bemol.com.br',
  'gestor',
  true,
  'geral',
  9999,
  '1a18abf7-9180-4a85-8836-93c97428b0eb'
)
ON CONFLICT (email) DO UPDATE
  SET nome          = EXCLUDED.nome,
      role          = EXCLUDED.role,
      ativo         = EXCLUDED.ativo,
      especialidade = EXCLUDED.especialidade,
      max_notas     = EXCLUDED.max_notas,
      auth_user_id  = EXCLUDED.auth_user_id;
