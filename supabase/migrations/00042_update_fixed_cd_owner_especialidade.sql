-- 00042_update_fixed_cd_owner_especialidade.sql
-- Ajusta especialidade/cargo dos responsáveis fixos de CD no painel de ordens.

UPDATE public.administradores
SET
  especialidade = 'cd_manaus',
  updated_at = now()
WHERE email = 'brendafonseca@bemol.com.br';

UPDATE public.administradores
SET
  especialidade = 'cd_taruma',
  updated_at = now()
WHERE email = 'adrianobezerra@bemol.com.br';
