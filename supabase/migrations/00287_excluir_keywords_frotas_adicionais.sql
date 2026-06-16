-- 00287_excluir_keywords_frotas_adicionais.sql
--
-- Novas keywords de frota (caminhões/veículos) identificadas a partir das notas
-- 10020047, 10158075, 10167050, 10167429 (excluídas pontualmente na 00286).
-- Mesmo mecanismo da 00238/00285: especialidade='excluir', pula_cockpit=true.
--
-- RECAPAGEM        - "SERV.RECAPAGEM KM ..." (recapagem de pneu)
-- BORRACHARIA      - serviço de borracharia
-- SUSPENSÃO        - "PREVENTIVA DA SUSPENSÃO" (suspensão de veículo)
-- BAÚ              - "SERVIÇO DE MANUTENÇÃO EM BAÚ" (baú de caminhão)

-- ============================================================
-- 1. Regras de distribuição
-- ============================================================
DELETE FROM public.regras_distribuicao
WHERE UPPER(palavra_chave) IN ('RECAPAGEM', 'BORRACHARIA', 'SUSPENSÃO', 'BAÚ');

INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('RECAPAGEM',  'excluir', true),
  ('BORRACHARIA','excluir', true),
  ('SUSPENSÃO',  'excluir', true),
  ('BAÚ',        'excluir', true);

-- ============================================================
-- 2. Backfill: marcar notas existentes com exclui_cockpit=true
-- ============================================================
UPDATE public.notas_manutencao
SET exclui_cockpit  = true,
    administrador_id = NULL,
    updated_at      = now()
WHERE exclui_cockpit = false
  AND (
    UPPER(descricao) LIKE '%RECAPAGEM%'
    OR UPPER(descricao) LIKE '%BORRACHARIA%'
    OR UPPER(descricao) LIKE '%SUSPENSÃO%'
    OR UPPER(descricao) LIKE '%BAÚ%'
  );

-- ============================================================
-- 3. Remover do cockpit (notas_convergencia_cockpit)
-- ============================================================
DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao
  WHERE exclui_cockpit = true
    AND (
      UPPER(descricao) LIKE '%RECAPAGEM%'
      OR UPPER(descricao) LIKE '%BORRACHARIA%'
      OR UPPER(descricao) LIKE '%SUSPENSÃO%'
      OR UPPER(descricao) LIKE '%BAÚ%'
    )
);
