-- 00285_excluir_frotas_cockpit.sql
--
-- Notas com "FROTAS" na descrição (ex: "ELÉTRICA - FROTAS") são notas de
-- manutenção de veículos/frota, não de equipamentos/predial geridos pelo
-- cockpit. Não devem aparecer no painel de notas nem ser distribuídas.
-- Mecanismo idêntico ao 00238 (MECÂNICA):
--   1. Regra com especialidade='excluir' e pula_cockpit=true
--   2. distribuir_notas() já detecta 'excluir' e seta exclui_cockpit=true sem atribuir
--   3. Backfill das notas existentes (libera administrador_id e remove do cockpit)

-- ============================================================
-- 1. Regra de distribuição
-- ============================================================
DELETE FROM public.regras_distribuicao
WHERE UPPER(palavra_chave) = 'FROTAS';

INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES ('FROTAS', 'excluir', true);

-- ============================================================
-- 2. Backfill: marcar notas existentes com exclui_cockpit=true
-- ============================================================
UPDATE public.notas_manutencao
SET exclui_cockpit  = true,
    administrador_id = NULL,
    updated_at      = now()
WHERE UPPER(descricao) LIKE '%FROTAS%';

-- ============================================================
-- 3. Remover do cockpit (notas_convergencia_cockpit)
-- ============================================================
DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao
  WHERE UPPER(descricao) LIKE '%FROTAS%'
);
