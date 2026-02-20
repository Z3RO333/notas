-- =============================================
-- MIGRATION 00015: Walter Rodrigues - gestor puro
-- Permanece no sistema como gestor mas não recebe ordens
-- e não aparece nos paineis de distribuição
-- Corrige também o nome (Rodriguez -> Rodrigues)
-- =============================================

UPDATE public.administradores
SET recebe_distribuicao = false,
    nome = 'Walter Rodrigues'
WHERE email = 'walterrodrigues@bemol.com.br';
