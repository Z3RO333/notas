-- 00169_remove_generic_geladeira_from_refrigeracao.sql
--
-- Corrige um falso positivo introduzido pela keyword genérica 'GELADEIRA'.
-- Mesmo após remover 'FREEZER' e 'TERMOMETRO DE GELADEIRA', notas como
-- 'TERMÔMETRO DE GELADEIRA' continuavam caindo em 'refrigeracao' por substring.
--
-- Regra nova:
--   - 'GELADEIRA' não deve mais direcionar notas para Suelem/refrigeracao.
--   - Esses casos passam a seguir o fluxo geral/CD definido em distribuir_notas().

DELETE FROM public.regras_distribuicao
WHERE especialidade = 'refrigeracao'
  AND UPPER(palavra_chave) = 'GELADEIRA';
