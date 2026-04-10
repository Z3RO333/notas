-- 00217_seed_luciana_oliveira.sql
-- Adiciona Luciana Oliveira como gestor (matrícula 15814).
-- recebe_distribuicao=false: não recebe notas.

INSERT INTO public.administradores (nome, email, role, ativo, especialidade, max_notas, recebe_distribuicao)
VALUES (
  'Luciana Oliveira',
  'lucianaoliveira@bemol.com.br',
  'gestor',
  true,
  'geral',
  9999,
  false
)
ON CONFLICT (email) DO UPDATE
  SET nome                = EXCLUDED.nome,
      role                = EXCLUDED.role,
      ativo               = EXCLUDED.ativo,
      especialidade       = EXCLUDED.especialidade,
      max_notas           = EXCLUDED.max_notas,
      recebe_distribuicao = EXCLUDED.recebe_distribuicao;
