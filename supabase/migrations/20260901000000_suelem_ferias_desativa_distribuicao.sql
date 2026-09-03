-- 20260901000000_suelem_ferias_desativa_distribuicao.sql
--
-- Suelém Silva (refrigeracao) está de férias. Ela NÃO é desligada e mantém
-- todas as ordens já sob sua responsabilidade (ordens_notas_acompanhamento
-- não é tocado). Apenas:
--
-- 1. Desativa recebe_distribuicao para ela parar de receber notas/ordens novas
--    (ativo e em_ferias permanecem inalterados — ela continua com login normal
--    e sua carteira de ordens existente).
-- 2. Libera as notas ainda sem ordem que estavam com ela (status='nova',
--    sem ordem vinculada) para redistribuição via distribuir_notas(), que já
--    cai automaticamente no pool 'geral' quando não há especialista de
--    refrigeracao disponível (ver 00167_ajuste_regras_cd_refrigeracao.sql).
--
-- Estado antes da migration (verificado em produção): 66 notas 'nova' sem
-- ordem vinculada a Suelém; 889 notas já concluídas com ordem permanecem com ela.

-- ============================================================
-- 1) Desativa distribuição para Suelém
-- ============================================================
UPDATE public.administradores
SET recebe_distribuicao = false,
    updated_at          = now()
WHERE email = 'suelemsilva@bemol.com.br';

-- ============================================================
-- 2) Libera notas pendentes (sem ordem) para redistribuição
-- ============================================================
UPDATE public.notas_manutencao n
SET administrador_id = NULL,
    distribuida_em   = NULL,
    updated_at       = now()
WHERE n.administrador_id = (SELECT id FROM public.administradores WHERE email = 'suelemsilva@bemol.com.br')
  AND n.status = 'nova'
  AND NOT EXISTS (
    SELECT 1 FROM public.ordens_notas_acompanhamento o WHERE o.nota_id = n.id
  );

-- ============================================================
-- 3) Redistribui as notas liberadas (cai no pool geral automaticamente,
--    já que Suelém está com recebe_distribuicao = false)
-- ============================================================
SELECT public.distribuir_notas();
