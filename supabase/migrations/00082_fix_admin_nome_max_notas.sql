-- 00082_fix_admin_nome_max_notas.sql
-- Corrige nome de "Fabio La Tentunge" → "Fabiola Tentuge"
-- e remove o limite prático de max_notas para todos os admins (50 → 9999)

UPDATE public.administradores
SET nome = 'Fabiola Tentuge'
WHERE email = 'fabiolatentunge@bemol.com.br';

-- max_notas=50 causava acúmulo de notas sem responsável quando admins atingiam a cota.
-- 9999 elimina esse gargalo na prática (coluna é NOT NULL INTEGER).
UPDATE public.administradores
SET max_notas = 9999;
