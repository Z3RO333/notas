-- 00255_pmpl_view_sem_dono_e_enrich_carteira
--
-- 1. vw_pmpl_fornecedores_sem_dono — fornecedores PMPL com ordens abertas sem responsável
-- 2. Atualiza vw_pmpl_carteira_resumo para enriquecer nomes via dim_fornecedores

CREATE OR REPLACE VIEW public.vw_pmpl_fornecedores_sem_dono AS
SELECT
  TRIM(UPPER(o.fornecedor_codigo))                              AS fornecedor_codigo,
  COALESCE(df.nome, o.fornecedor_nome, o.fornecedor_codigo)    AS fornecedor_nome,
  COUNT(o.id)::INTEGER                                          AS qtd_abertas
FROM public.ordens_notas_acompanhamento o
LEFT JOIN public.dim_fornecedores df
       ON df.codigo = TRIM(UPPER(o.fornecedor_codigo))
WHERE o.tipo_ordem = 'PMPL'
  AND o.fornecedor_codigo IS NOT NULL
  AND o.status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA')
  AND TRIM(UPPER(o.fornecedor_codigo)) NOT IN (
        SELECT fornecedor_codigo
        FROM public.pmpl_carteira_fornecedor
        WHERE ativo = true
      )
GROUP BY TRIM(UPPER(o.fornecedor_codigo)),
         COALESCE(df.nome, o.fornecedor_nome, o.fornecedor_codigo)
ORDER BY qtd_abertas DESC;

COMMENT ON VIEW public.vw_pmpl_fornecedores_sem_dono IS
  'Fornecedores PMPL com ordens abertas que ainda não têm responsável na carteira.';

CREATE OR REPLACE VIEW public.vw_pmpl_carteira_resumo AS
SELECT
  c.fornecedor_codigo,
  COALESCE(df.nome, c.fornecedor_nome)                          AS fornecedor_nome,
  a.id                                                          AS admin_id,
  a.nome                                                        AS admin_nome,
  a.avatar_url                                                  AS admin_avatar,
  COUNT(o.id) FILTER (
    WHERE o.status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA')
  )::INTEGER AS qtd_abertas,
  COUNT(o.id) FILTER (
    WHERE o.status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA')
      AND GREATEST((CURRENT_DATE - o.ordem_detectada_em::date), 0) >= 7
  )::INTEGER AS qtd_atrasadas
FROM public.pmpl_carteira_fornecedor c
JOIN public.administradores a
     ON a.id = c.administrador_id
LEFT JOIN public.dim_fornecedores df
     ON df.codigo = c.fornecedor_codigo
LEFT JOIN public.ordens_notas_acompanhamento o
     ON TRIM(UPPER(o.fornecedor_codigo)) = c.fornecedor_codigo
    AND o.tipo_ordem = 'PMPL'
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, COALESCE(df.nome, c.fornecedor_nome),
         a.id, a.nome, a.avatar_url
ORDER BY qtd_abertas DESC NULLS LAST;

COMMENT ON VIEW public.vw_pmpl_carteira_resumo IS
  'Carteira PMPL por fornecedor com nome enriquecido via dim_fornecedores.';
