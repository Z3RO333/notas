-- =============================================
-- MIGRATION 00015: Walter Rodrigues - gestor puro
-- Permanece no sistema como gestor mas nao recebe ordens
-- e nao aparece nos paineis de distribuicao
-- Corrige tambem o nome (Rodriguez -> Rodrigues)
-- =============================================

UPDATE public.administradores
SET recebe_distribuicao = false,
    nome = 'Walter Rodrigues'
WHERE email = 'walterrodrigues@bemol.com.br';
