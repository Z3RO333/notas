-- 00041_seed_fixed_cd_owners.sql
-- Garante os responsáveis fixos do painel de ordens para roteamento por unidade.
-- Especialidade/cargo dedicado por CD:
-- - Brenda -> cd_manaus
-- - Adriano -> cd_taruma

INSERT INTO public.administradores (
  nome,
  email,
  role,
  ativo,
  max_notas,
  especialidade,
  recebe_distribuicao,
  em_ferias
)
VALUES
  ('Brenda Fonseca', 'brendafonseca@bemol.com.br', 'admin', true, 50, 'cd_manaus', false, false),
  ('Adriano Bezerra', 'adrianobezerra@bemol.com.br', 'admin', true, 50, 'cd_taruma', false, false)
ON CONFLICT (email) DO UPDATE SET
  nome = EXCLUDED.nome,
  role = 'admin',
  ativo = true,
  especialidade = EXCLUDED.especialidade,
  recebe_distribuicao = false,
  em_ferias = false,
  updated_at = now();
