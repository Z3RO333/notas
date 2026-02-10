-- 00009_remove_auth_and_seed_admins.sql
-- Remove dependencia do Supabase Auth e insere os administradores reais

-- ============================================================
-- 1. TORNAR auth_user_id OPCIONAL (sem login nao precisamos mais)
-- ============================================================
ALTER TABLE public.administradores DROP CONSTRAINT IF EXISTS administradores_auth_user_id_fkey;
ALTER TABLE public.administradores ALTER COLUMN auth_user_id DROP NOT NULL;

-- ============================================================
-- 2. DESABILITAR RLS NA TABELA DE REGRAS (esquecido no 00007)
-- ============================================================
ALTER TABLE public.regras_distribuicao DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. INSERIR OS ADMINISTRADORES
-- ============================================================

-- Suelem Silva - Refrigeracao
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Suelem Silva', 'suelemsilva@bemol.com.br', 'admin', true, 50, 'refrigeracao')
ON CONFLICT (email) DO NOTHING;

-- Gustavo Andrade - Elevadores/Geradores (Gestor)
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Gustavo Andrade', 'gustavoandrade@bemol.com.br', 'gestor', true, 50, 'elevadores')
ON CONFLICT (email) DO NOTHING;

-- Paula Matos - Elevadores/Geradores
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Paula Matos', 'paulamatos@bemol.com.br', 'admin', true, 50, 'elevadores')
ON CONFLICT (email) DO NOTHING;

-- Wanderlucio Mendes - Geral
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Wanderlucio Mendes', 'wanderluciomendes@bemol.com.br', 'admin', true, 50, 'geral')
ON CONFLICT (email) DO NOTHING;

-- Rosana Figueira - Geral
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Rosana Figueira', 'rosanafigueira@bemol.com.br', 'admin', true, 50, 'geral')
ON CONFLICT (email) DO NOTHING;

-- Mayky Castro - Geral
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Mayky Castro', 'maykycastro@bemol.com.br', 'admin', true, 50, 'geral')
ON CONFLICT (email) DO NOTHING;

-- Fabio La Tentunge - Geral
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Fabio La Tentunge', 'fabiolatentunge@bemol.com.br', 'admin', true, 50, 'geral')
ON CONFLICT (email) DO NOTHING;
