-- 00200_fix_listar_gestao_overload_ambiguity.sql
--
-- Migration 00198 adicionou p_nome_loja a listar_gestao_ordens_base_filtrada criando um
-- overload de 7 argumentos (CREATE OR REPLACE com assinatura diferente cria uma nova
-- sobrecarga, não substitui a versão existente de 6 argumentos).
--
-- Isso recriou a ambiguidade de overload que 00192 havia resolvido: qualquer chamada
-- posicional com 6 argumentos corresponde tanto à versão de 6 args (correspondência exata)
-- quanto à versão de 7 args (7º arg com DEFAULT NULL), causando erro PostgreSQL
-- "function is not unique" — que quebrou calcular_comparativo_ordens_mensal e a página
-- /admin/comparativos.
--
-- Correção: DROP na versão de 6 args. A versão de 7 args (com p_nome_loja DEFAULT NULL)
-- resolve chamadas com 6 argumentos sem ambiguidade, pois o 7º arg usa o default.

DROP FUNCTION IF EXISTS public.listar_gestao_ordens_base_filtrada(
  integer,
  integer,
  text,
  text,
  text,
  integer
);
