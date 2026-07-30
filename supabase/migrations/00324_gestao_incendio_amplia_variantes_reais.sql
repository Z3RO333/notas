-- 00324_gestao_incendio_amplia_variantes_reais.sql
--
-- Follow-up da migration 00323 (gestao_incendio_seed_regras). Ao rodar a
-- validação do Step 3 do plano contra dados reais de notas_manutencao,
-- foram encontradas ~127 notas com variantes de palavras-chave de incêndio
-- (acentuação e erros de digitação recorrentes do texto SAP) não cobertas
-- pelas keywords cadastradas em 00323. Esta migration amplia a cobertura
-- sem alterar o arquivo já aplicado 00323, preservando a imutabilidade de
-- migrations já executadas.

-- 5. Amplia palavras-chave de incêndio com variantes reais encontradas no
--    banco (acentuação e erros de digitação recorrentes do texto SAP),
--    descobertas ao validar a migration 00323 contra dados reais.
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('BOMBA DE INCÊNDIO',    'criticos', false),  -- 29 notas reais, acentuado
  ('CENTRAL DI INCÊNDIO',  'criticos', false),  -- 27 notas reais, typo "DI" recorrente
  ('CENTRAL DE INCÊNDIO',  'criticos', false),  -- variante correta acentuada
  ('COMBATE A INCÊNDIO',   'criticos', false),  -- 15 notas reais (EQUIP.COMBATE A INCÊNDIO / Complemento Inst.Combate a Incêndio)
  ('PROJETO DE INCÊNDIO',  'criticos', false),  -- 7 notas reais (ATUALIZAÇÃO PROJETO DE INCÊNDIO)
  ('ESTINTOR DE INCENDIO', 'criticos', false)   -- typo "ESTINTOR" por "EXTINTOR"
ON CONFLICT DO NOTHING;
