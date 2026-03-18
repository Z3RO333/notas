-- 00176_notes_em_campo_suggestions.sql
--
-- Apoio ao modal "Em Campo" do Painel de Notas.
-- Mantem o painel ancorado em vw_notas_sem_ordem/vw_carga_real_administradores
-- e expõe somente RPCs isolados para:
-- 1) listar servicos historicos usados no filtro do modal
-- 2) rankear fornecedores externos por correlacao loja + servico

CREATE OR REPLACE FUNCTION public.listar_servicos_historicos_notas_em_campo(
  p_limit integer DEFAULT 250
)
RETURNS TABLE(
  texto_breve text,
  total_ordens integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      NULLIF(BTRIM(o.texto_breve), '') AS texto_breve,
      COALESCE(o.data_entrada::date, o.ordem_detectada_em::date) AS data_referencia
    FROM public.ordens_notas_acompanhamento o
    WHERE NULLIF(BTRIM(o.texto_breve), '') IS NOT NULL
  )
  SELECT
    b.texto_breve,
    COUNT(*)::integer AS total_ordens
  FROM base b
  WHERE b.data_referencia >= (current_date - INTERVAL '12 months')::date
  GROUP BY b.texto_breve
  ORDER BY total_ordens DESC, b.texto_breve ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 250), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.buscar_sugestoes_operacionais_externos_notas_em_campo(
  p_nome_loja text,
  p_texto_breve text
)
RETURNS TABLE(
  fornecedor_codigo text,
  fornecedor_nome text,
  total_em_campo integer,
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
      REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g') AS fornecedor_codigo_norm,
      COALESCE(
        NULLIF(BTRIM(d.nome), ''),
        NULLIF(BTRIM(o.fornecedor_nome), ''),
        REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g')
      ) AS fornecedor_nome_norm,
      COALESCE(
        NULLIF(BTRIM(o.denominacao_unidade), ''),
        NULLIF(BTRIM(o.unidade), '')
      ) AS nome_loja,
      NULLIF(BTRIM(o.texto_breve), '') AS texto_breve,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS status_ordem_raw,
      COALESCE(o.data_entrada::date, o.ordem_detectada_em::date) AS data_referencia
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g')
    WHERE NULLIF(REGEXP_REPLACE(COALESCE(o.fornecedor_codigo, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      AND NULLIF(BTRIM(o.texto_breve), '') IS NOT NULL
  ),
  carga_atual AS (
    SELECT
      b.fornecedor_codigo_norm AS fornecedor_codigo,
      MAX(b.fornecedor_nome_norm) AS fornecedor_nome,
      COUNT(*)::integer AS total_em_campo
    FROM base b
    WHERE b.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
    GROUP BY b.fornecedor_codigo_norm
  ),
  historico_loja_servico AS (
    SELECT
      b.fornecedor_codigo_norm AS fornecedor_codigo,
      COUNT(*)::integer AS historico_loja_servico
    FROM base b
    CROSS JOIN params p
    WHERE p.nome_loja IS NOT NULL
      AND p.texto_breve IS NOT NULL
      AND b.data_referencia >= (current_date - INTERVAL '12 months')::date
      AND UPPER(BTRIM(COALESCE(b.nome_loja, ''))) = UPPER(p.nome_loja)
      AND UPPER(BTRIM(COALESCE(b.texto_breve, ''))) = UPPER(p.texto_breve)
    GROUP BY b.fornecedor_codigo_norm
  ),
  historico_servico AS (
    SELECT
      b.fornecedor_codigo_norm AS fornecedor_codigo,
      COUNT(*)::integer AS historico_servico_geral
    FROM base b
    CROSS JOIN params p
    WHERE p.texto_breve IS NOT NULL
      AND b.data_referencia >= (current_date - INTERVAL '12 months')::date
      AND UPPER(BTRIM(COALESCE(b.texto_breve, ''))) = UPPER(p.texto_breve)
    GROUP BY b.fornecedor_codigo_norm
  )
  SELECT
    hs.fornecedor_codigo,
    COALESCE(ca.fornecedor_nome, MAX(b.fornecedor_nome_norm), hs.fornecedor_codigo) AS fornecedor_nome,
    COALESCE(ca.total_em_campo, 0) AS total_em_campo,
    COALESCE(hls.historico_loja_servico, 0) AS historico_loja_servico,
    hs.historico_servico_geral,
    CASE
      WHEN COALESCE(hls.historico_loja_servico, 0) > 0 THEN 'exato'
      ELSE 'fallback_servico'
    END AS match_mode
  FROM historico_servico hs
  LEFT JOIN historico_loja_servico hls
    ON hls.fornecedor_codigo = hs.fornecedor_codigo
  LEFT JOIN carga_atual ca
    ON ca.fornecedor_codigo = hs.fornecedor_codigo
  LEFT JOIN base b
    ON b.fornecedor_codigo_norm = hs.fornecedor_codigo
  GROUP BY
    hs.fornecedor_codigo,
    ca.fornecedor_nome,
    ca.total_em_campo,
    hls.historico_loja_servico,
    hs.historico_servico_geral
  ORDER BY
    COALESCE(hls.historico_loja_servico, 0) DESC,
    COALESCE(ca.total_em_campo, 0) ASC,
    hs.historico_servico_geral DESC,
    fornecedor_nome ASC;
$$;
