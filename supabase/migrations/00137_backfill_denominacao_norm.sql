-- 00137_backfill_denominacao_norm.sql
-- Normaliza denominacao_unidade existente no banco usando dim_denominacao_norm.

-- Passo 1: ordens COM denominacao_unidade — substitui variantes pelo nome canônico
UPDATE public.ordens_notas_acompanhamento ona
SET denominacao_unidade = n.nome_canonical
FROM public.dim_denominacao_norm n
WHERE n.raw_nome = NULLIF(BTRIM(ona.denominacao_unidade), '')
  AND n.nome_canonical <> NULLIF(BTRIM(ona.denominacao_unidade), '');

-- Passo 2: ordens SEM denominacao_unidade — preenche com o nome canônico do unidade shortcode
UPDATE public.ordens_notas_acompanhamento ona
SET denominacao_unidade = n.nome_canonical
FROM public.dim_denominacao_norm n
WHERE ona.denominacao_unidade IS NULL
  AND n.raw_nome = ona.unidade;
