-- 00238_excluir_mecanica_cockpit.sql
--
-- Notas com "MECÂNICA" na descrição não devem aparecer no cockpit.
-- Mecanismo idêntico ao 00221 (PREVENTIVA DE 1.500 HORAS):
--   1. Regra com especialidade='excluir' e pula_cockpit=true
--   2. distribuir_notas() já detecta 'excluir' e seta exclui_cockpit=true sem atribuir
--   3. Backfill das notas existentes

-- ============================================================
-- 1. Regra de distribuição
-- ============================================================
DELETE FROM public.regras_distribuicao
WHERE UPPER(palavra_chave) = 'MECÂNICA';

INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES ('MECÂNICA', 'excluir', true);

-- ============================================================
-- 2. Backfill: marcar notas existentes com exclui_cockpit=true
-- ============================================================
UPDATE public.notas_manutencao
SET exclui_cockpit  = true,
    administrador_id = NULL,
    updated_at      = now()
WHERE UPPER(descricao) LIKE '%MECÂNICA%'
   OR UPPER(descricao) LIKE '%MECANICA%';

-- ============================================================
-- 3. Remover do cockpit (notas_convergencia_cockpit)
-- ============================================================
DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao
  WHERE UPPER(descricao) LIKE '%MECÂNICA%'
     OR UPPER(descricao) LIKE '%MECANICA%'
);
