-- 00196_dim_operacionais_avatar_e_novos.sql
--
-- 1. Adiciona coluna avatar_url em dim_operacionais
-- 2. Insere David Bezerra Viana (19233) e Pedro Vieira Ramos (21025)

ALTER TABLE public.dim_operacionais
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.dim_operacionais.avatar_url IS
  'Caminho relativo da foto do operacional (ex: /avatars/arinaldoviana.jpg).';

INSERT INTO public.dim_operacionais (codigo, nome) VALUES
  ('19233', 'DAVID BEZERRA VIANA'),
  ('21025', 'PEDRO VIEIRA RAMOS')
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, updated_at = now();
