-- 00177_notes_em_campo_operacionais_loja.sql
--
-- Complementa o modal "Em Campo" do Painel de Notas com:
-- 1) carga atual de todos os operacionais conhecidos, inclusive zerados
-- 2) contagem de ordens ativas na mesma loja
-- 3) ranking de sugestao por loja + servico, priorizando consolidacao na loja

CREATE OR REPLACE FUNCTION public.listar_operacionais_carga_notas_em_campo(
  p_nome_loja text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_codigo text,
  fornecedor_nome text,
  total_em_campo integer,
  ordens_mesma_loja_ativas integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT NULLIF(BTRIM(p_nome_loja), '') AS nome_loja
  ),
  base AS (
    SELECT
      d.codigo AS fornecedor_codigo,
      d.nome AS fornecedor_nome,
      COALESCE(
        NULLIF(BTRIM(o.denominacao_unidade), ''),
        NULLIF(BTRIM(o.unidade), '')
      ) AS nome_loja,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS status_ordem_raw
    FROM public.ordens_notas_acompanhamento o
    INNER JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g')
  ),
  carga_atual AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS total_em_campo
    FROM base b
    WHERE b.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
    GROUP BY b.fornecedor_codigo
  ),
  carga_mesma_loja AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS ordens_mesma_loja_ativas
    FROM base b
    CROSS JOIN params p
    WHERE p.nome_loja IS NOT NULL
      AND b.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
      AND UPPER(BTRIM(COALESCE(b.nome_loja, ''))) = UPPER(p.nome_loja)
    GROUP BY b.fornecedor_codigo
  )
  SELECT
    d.codigo AS fornecedor_codigo,
    d.nome AS fornecedor_nome,
    COALESCE(ca.total_em_campo, 0) AS total_em_campo,
    COALESCE(cml.ordens_mesma_loja_ativas, 0) AS ordens_mesma_loja_ativas
  FROM public.dim_operacionais d
  LEFT JOIN carga_atual ca
    ON ca.fornecedor_codigo = d.codigo
  LEFT JOIN carga_mesma_loja cml
    ON cml.fornecedor_codigo = d.codigo
  WHERE d.ativo = true
  ORDER BY
    COALESCE(cml.ordens_mesma_loja_ativas, 0) DESC,
    COALESCE(ca.total_em_campo, 0) ASC,
    d.nome ASC;
$$;

CREATE OR REPLACE FUNCTION public.buscar_sugestoes_operacionais_notas_em_campo(
  p_nome_loja text,
  p_texto_breve text
)
RETURNS TABLE(
  fornecedor_codigo text,
  fornecedor_nome text,
  total_em_campo integer,
  ordens_mesma_loja_ativas integer,
  historico_loja_servico integer,
  historico_servico_geral integer,
  match_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      NULLIF(BTRIM(p_nome_loja), '') AS nome_loja,
      NULLIF(BTRIM(p_texto_breve), '') AS texto_breve
  ),
  base AS (
    SELECT
      d.codigo AS fornecedor_codigo,
      d.nome AS fornecedor_nome,
      COALESCE(
        NULLIF(BTRIM(o.denominacao_unidade), ''),
        NULLIF(BTRIM(o.unidade), '')
      ) AS nome_loja,
      NULLIF(BTRIM(o.texto_breve), '') AS texto_breve,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS status_ordem_raw,
      COALESCE(o.data_entrada::date, o.ordem_detectada_em::date) AS data_referencia
    FROM public.ordens_notas_acompanhamento o
    INNER JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g')
    WHERE NULLIF(BTRIM(o.texto_breve), '') IS NOT NULL
  ),
  carga_atual AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS total_em_campo
    FROM base b
    WHERE b.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
    GROUP BY b.fornecedor_codigo
  ),
  carga_mesma_loja AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS ordens_mesma_loja_ativas
    FROM base b
    CROSS JOIN params p
    WHERE p.nome_loja IS NOT NULL
      AND b.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
      AND UPPER(BTRIM(COALESCE(b.nome_loja, ''))) = UPPER(p.nome_loja)
    GROUP BY b.fornecedor_codigo
  ),
  historico_loja_servico AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS historico_loja_servico
    FROM base b
    CROSS JOIN params p
    WHERE p.nome_loja IS NOT NULL
      AND p.texto_breve IS NOT NULL
      AND b.data_referencia >= (current_date - INTERVAL '12 months')::date
      AND UPPER(BTRIM(COALESCE(b.nome_loja, ''))) = UPPER(p.nome_loja)
      AND UPPER(BTRIM(COALESCE(b.texto_breve, ''))) = UPPER(p.texto_breve)
    GROUP BY b.fornecedor_codigo
  ),
  historico_servico AS (
    SELECT
      b.fornecedor_codigo,
      COUNT(*)::integer AS historico_servico_geral
    FROM base b
    CROSS JOIN params p
    WHERE p.texto_breve IS NOT NULL
      AND b.data_referencia >= (current_date - INTERVAL '12 months')::date
      AND UPPER(BTRIM(COALESCE(b.texto_breve, ''))) = UPPER(p.texto_breve)
    GROUP BY b.fornecedor_codigo
  )
  SELECT
    d.codigo AS fornecedor_codigo,
    d.nome AS fornecedor_nome,
    COALESCE(ca.total_em_campo, 0) AS total_em_campo,
    COALESCE(cml.ordens_mesma_loja_ativas, 0) AS ordens_mesma_loja_ativas,
    COALESCE(hls.historico_loja_servico, 0) AS historico_loja_servico,
    COALESCE(hs.historico_servico_geral, 0) AS historico_servico_geral,
    CASE
      WHEN COALESCE(hls.historico_loja_servico, 0) > 0 THEN 'exato'
      ELSE 'fallback_servico'
    END AS match_mode
  FROM public.dim_operacionais d
  LEFT JOIN carga_atual ca
    ON ca.fornecedor_codigo = d.codigo
  LEFT JOIN carga_mesma_loja cml
    ON cml.fornecedor_codigo = d.codigo
  LEFT JOIN historico_loja_servico hls
    ON hls.fornecedor_codigo = d.codigo
  LEFT JOIN historico_servico hs
    ON hs.fornecedor_codigo = d.codigo
  WHERE d.ativo = true
    AND (
      COALESCE(cml.ordens_mesma_loja_ativas, 0) > 0
      OR COALESCE(hls.historico_loja_servico, 0) > 0
      OR COALESCE(hs.historico_servico_geral, 0) > 0
    )
  ORDER BY
    COALESCE(cml.ordens_mesma_loja_ativas, 0) DESC,
    COALESCE(hls.historico_loja_servico, 0) DESC,
    COALESCE(ca.total_em_campo, 0) ASC,
    COALESCE(hs.historico_servico_geral, 0) DESC,
    d.nome ASC;
$$;
