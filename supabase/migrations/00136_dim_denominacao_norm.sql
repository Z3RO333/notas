-- 00136_dim_denominacao_norm.sql
-- Tabela de normalização de nomes de unidade.
-- Mapeia qualquer variante bruta (denominacao_unidade ou unidade shortcode)
-- para um nome canônico e classificação correta de tipo (LOJA/CD/FARMA).
-- Resolve fragmentação ("MATRIZ" vs "Loja Matriz") e classificação errada
-- ("Centro de Distribuição Manaus" aparecendo no gráfico de Lojas).

CREATE TABLE IF NOT EXISTS public.dim_denominacao_norm (
  raw_nome             TEXT PRIMARY KEY,
  nome_canonical       TEXT NOT NULL,
  tipo_unidade_override TEXT CHECK (tipo_unidade_override IN ('LOJA','CD','FARMA'))
);

COMMENT ON TABLE public.dim_denominacao_norm IS
  'Normaliza variantes de nome de unidade para um nome canônico e tipo correto.';

INSERT INTO public.dim_denominacao_norm (raw_nome, nome_canonical, tipo_unidade_override)
VALUES
  -- MATRIZ / Loja Matriz
  ('MATRIZ',                            'Loja Matriz',                     'LOJA'),
  ('Loja Matriz',                       'Loja Matriz',                     'LOJA'),

  -- CD Manaus
  ('CD MANAUS',                         'CD Manaus',                       'CD'),
  ('Centro de Distribuição Manaus',     'CD Manaus',                       'CD'),
  ('Centro de Distribui??o Manaus',     'CD Manaus',                       'CD'),

  -- CD Mercado Tarumaã (centro 148 = CD TARUMA)
  ('CD TARUMA',                         'CD Mercado Tarumaã',              'CD'),
  ('CD Mercado Tarumaã',                'CD Mercado Tarumaã',              'CD'),
  ('CD Mercado Tarum?',                 'CD Mercado Tarumaã',              'CD'),
  ('VAREJO CD',                         'CD Mercado Tarumaã',              'CD'),

  -- CD Farma Tarumaã (centro 149 = CD FARMA TARUMA)
  ('CD FARMA TARUMA',                   'CD Farma Tarumaã',                'CD'),
  ('CD Farma Tarumaã',                  'CD Farma Tarumaã',                'CD'),
  ('CD Farma Tarum?',                   'CD Farma Tarumaã',                'CD'),

  -- CD Boa Vista (centro 704 = CD BOA VISTA)
  ('CD BOA VISTA',                      'CD Boa Vista',                    'CD'),
  ('Boa Vista CD',                      'CD Boa Vista',                    'CD'),

  -- CD Porto (centro 170 = CD PORTO)
  ('CD PORTO',                          'CD Porto',                        'CD'),

  -- CD Porto Velho (centro 203 = CD PORTO VELHO)
  ('CD PORTO VELHO',                    'CD Porto Velho',                  'CD'),
  ('Centro de Distribuição Porto Velho','CD Porto Velho',                  'CD'),
  ('Centro de Distribui??o Porto Velho','CD Porto Velho',                  'CD'),

  -- CD II / CD III
  ('CD II',                             'CD II',                           'CD'),
  ('CD III',                            'CD III',                          'CD'),

  -- Farma Matriz (centro 605 = BEMOL FARMA MATRIZ)
  ('BEMOL FARMA MATRIZ',                'Farma Matriz',                    'FARMA'),
  ('Farma Matriz',                      'Farma Matriz',                    'FARMA'),

  -- Lojas com nome diferente do shortcode
  ('SHOPPING MANAUARA',                 'Loja Manauara',                   'LOJA'),
  ('Loja Manauara',                     'Loja Manauara',                   'LOJA'),
  ('SHOPPING STUDIO 5',                 'Loja Studio 5',                   'LOJA'),
  ('Loja Studio 5',                     'Loja Studio 5',                   'LOJA'),
  ('SHOPPING PONTA NEGRA',              'Loja Shopping Ponta Negra',       'LOJA'),
  ('Loja Shopping Ponta Negra',         'Loja Shopping Ponta Negra',       'LOJA'),
  ('SHOPPING BOA VISTA',                'Loja Boa Vista Shopping',         'LOJA'),
  ('Loja Boa Vista Shopping',           'Loja Boa Vista Shopping',         'LOJA'),
  ('PORTO VELHO CENTRO',                'Loja Porto Velho Centro',         'LOJA'),
  ('Loja Porto Velho Centro',           'Loja Porto Velho Centro',         'LOJA'),
  ('SHOPPING MILLENNIUM',               'Loja Shopping Millennium',        'LOJA'),
  ('SHOPPING PORTO VELHO',              'Loja Porto Velho Shopping',       'LOJA'),
  ('Loja Porto Velho Shopping',         'Loja Porto Velho Shopping',       'LOJA')
ON CONFLICT (raw_nome) DO UPDATE
  SET nome_canonical       = EXCLUDED.nome_canonical,
      tipo_unidade_override = EXCLUDED.tipo_unidade_override;

CREATE INDEX IF NOT EXISTS idx_dim_denominacao_norm_canonical
  ON public.dim_denominacao_norm (nome_canonical);

-- ---------------------------------------------------------------------------
-- Atualiza vw_dashboard_gestao_manutencao com join na tabela de normalização
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.vw_dashboard_gestao_manutencao;

CREATE VIEW public.vw_dashboard_gestao_manutencao AS
SELECT
  COALESCE(
    norm.nome_canonical,
    NULLIF(BTRIM(ona.denominacao_unidade), ''),
    ona.unidade
  )                                                                             AS nome_loja,
  n.centro,
  n.descricao                                                                   AS texto_breve,
  ona.tipo_ordem,
  COALESCE(
    norm.tipo_unidade_override,
    CASE
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
        THEN 'CD'
      WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
        OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
        THEN 'FARMA'
      WHEN ona.unidade IS NOT NULL THEN 'LOJA'
      ELSE NULL
    END
  )                                                                             AS tipo_unidade,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int    AS ano,
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int    AS mes,
  COUNT(DISTINCT ona.id)                                                        AS total_ordens,
  COUNT(DISTINCT n.id)                                                          AS total_notas
FROM public.notas_manutencao n
LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
LEFT JOIN public.dim_denominacao_norm norm
  ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
WHERE n.descricao <> ''
GROUP BY
  COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade),
  norm.tipo_unidade_override,
  ona.unidade,
  n.centro,
  n.descricao,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date)),
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date));

-- ---------------------------------------------------------------------------
-- Atualiza calcular_gestao_top_lojas_por_status com join na normalização
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_gestao_top_lojas_por_status(
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL,
  p_tipo_ordem TEXT    DEFAULT NULL
)
RETURNS TABLE(
  nome_loja    TEXT,
  tipo_unidade TEXT,
  concluidas   INTEGER,
  em_aberto    INTEGER,
  total_ordens INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.notas_manutencao n
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE
      BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
      AND (p_tipo_ordem IS NULL OR ona.tipo_ordem = p_tipo_ordem)
  )
  SELECT
    b.nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto,
    COUNT(*)::INTEGER                                                       AS total_ordens
  FROM base b
  WHERE
    b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;
