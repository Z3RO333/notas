-- 00140_criado_por.sql
-- Adiciona coluna criado_por à tabela ordens_notas_acompanhamento

ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS criado_por TEXT;
