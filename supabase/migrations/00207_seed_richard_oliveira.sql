-- 00207_seed_richard_oliveira.sql
--
-- Insere o colaborador Richard Oliveira (matrícula 21634).
-- Role: admin, especialidade: cd_manaus
-- recebe_distribuicao: false até ser ativado manualmente pelo gestor.

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
VALUES (
  'Richard Oliveira',
  'richardoliveira@bemol.com.br',
  'admin',
  TRUE,
  0,
  'cd_manaus',
  FALSE,
  FALSE
)
ON CONFLICT (email) DO UPDATE
SET
  nome                = 'Richard Oliveira',
  role                = 'admin',
  ativo               = TRUE,
  especialidade       = 'cd_manaus',
  updated_at          = now();
