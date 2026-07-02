-- 00302_trgm_indexes_keyword_joins.sql
--
-- As RPCs de /admin/equipamentos (vw_equipamentos_criticos,
-- calcular_equipamentos_top_lojas) fazem LIKE-join de keywords de
-- regras_distribuicao contra notas_manutencao.descricao e
-- ordens_financeiro_importado.texto_breve:
--
--   JOIN regras_distribuicao r
--     ON UPPER(x.texto) LIKE '%' || UPPER(r.palavra_chave) || '%'
--
-- Sem índice, cada chamada avalia ~806k LIKEs (22,5k notas × 36 keywords) +
-- ~1,42M LIKEs (39,8k linhas financeiro × 36 keywords) — medido via EXPLAIN
-- ANALYZE (3,4s por varredura da view).
--
-- Índices GIN trigram sobre a MESMA expressão usada no join (upper(...))
-- permitem ao planner inverter o nested loop: para cada keyword (~36),
-- um bitmap index scan — em vez de avaliar todas as combinações.
-- pg_trgm já está instalada (índices trgm existentes em ordens_notas_acompanhamento).

CREATE INDEX IF NOT EXISTS idx_notas_descricao_upper_trgm
  ON public.notas_manutencao
  USING gin ((upper(descricao)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_financeiro_texto_breve_upper_trgm
  ON public.ordens_financeiro_importado
  USING gin ((upper(texto_breve)) gin_trgm_ops);
