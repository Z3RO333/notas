-- =============================================
-- MIGRATION 00021: Adicionar Jacenira e Daniel como gestores puros
-- Mesma configuracao do Walter: role=gestor, recebe_distribuicao=false
-- =============================================

INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade, recebe_distribuicao, em_ferias)
VALUES
  ('Jacenira', 'jacenira@bemol.com.br', 'gestor', true, 50, 'geral', false, false),
  ('Daniel Damasceno', 'danieldamasceno@bemol.com.br', 'gestor', true, 50, 'geral', false, false)
ON CONFLICT (email) DO UPDATE SET
  role = 'gestor',
  recebe_distribuicao = false,
  ativo = true,
  updated_at = now();
