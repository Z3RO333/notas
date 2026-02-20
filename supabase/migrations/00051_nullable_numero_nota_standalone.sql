-- 00051_nullable_numero_nota_standalone.sql
-- Permite ordens standalone (ex: PMPL sem nota) com numero_nota = NULL.
--
-- Contexto: 00050 tornou nota_id nullable, mas numero_nota (coluna
-- denormalizada que replica nota.numero_nota) continuou NOT NULL, causando
-- violação de constraint ao inserir via importar_ordens_pmpl_standalone.

ALTER TABLE public.ordens_notas_acompanhamento
  ALTER COLUMN numero_nota DROP NOT NULL;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.numero_nota IS
  'Número da nota de origem (denormalizado). NULL para ordens standalone sem nota correspondente.';
