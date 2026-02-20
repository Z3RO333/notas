-- 00047_paula_geral_and_gustavo_only_pmpl.sql
-- Ajusta alocação operacional:
-- 1) Paula passa a atuar como geral.
-- 2) Gustavo deixa de receber distribuição de notas (atua apenas no contexto PMPL).

UPDATE public.administradores
SET
  especialidade = 'geral',
  updated_at = now()
WHERE email = 'paulamatos@bemol.com.br';

UPDATE public.administradores
SET
  recebe_distribuicao = false,
  motivo_bloqueio = 'Atuação exclusiva PMPL',
  updated_at = now()
WHERE email = 'gustavoandrade@bemol.com.br';
