-- 00263_concluidas_ranking_por_data_conclusao.sql
--
-- Corrige a semântica de "Concluídas" no ranking de produtividade:
-- ANTES: contava ordens detectadas no período que estão concluídas hoje
--        → uma ordem aberta em março e concluída em maio não entrava em maio
-- DEPOIS: conta ordens efetivamente concluídas no período (por concluido_em)
--         → reflete produtividade real do mês
--
-- Mudanças:
--   1. vw_ordens_notas_painel: expõe concluido_em da tabela base
--   2. calcular_ranking_ordens_admin: usa concluido_em para qtd_concluidas_30d

-- ============================================================
-- 1. View: adiciona concluido_em
-- ============================================================
CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT na.nota_id,
    count(*) AS qtd_historico,
    array_agg(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM nota_acompanhamentos na
  GROUP BY na.nota_id
), base AS (
  SELECT
    o.id                                                        AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome                                                 AS administrador_nome,
    CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
    END                                                         AS responsavel_atual_id,
    atual.nome                                                  AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade)                              AS unidade,
    normalizar_status_ordem(o.status_ordem_raw)                 AS status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em)              AS ordem_detectada_em,
    o.status_atualizado_em,
    COALESCE(o.concluido_em, o.concluida_em)                   AS concluido_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0::bigint)                        AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::uuid[])            AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem,
    n.hora_nota
  FROM ordens_notas_acompanhamento o
  LEFT JOIN notas_manutencao n        ON n.id = o.nota_id
  LEFT JOIN administradores origem    ON origem.id = o.administrador_id
  LEFT JOIN administradores atual     ON atual.id = CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
    END
  LEFT JOIN dim_centro_unidade d      ON d.centro = o.centro
  LEFT JOIN historico h               ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NOT NULL
    AND (n.id IS NULL OR n.exclui_cockpit = false)
)
SELECT
  ordem_id,
  nota_id,
  numero_nota,
  ordem_codigo,
  administrador_id,
  administrador_nome,
  responsavel_atual_id,
  responsavel_atual_nome,
  centro,
  unidade,
  status_ordem,
  status_ordem_raw,
  ordem_detectada_em,
  status_atualizado_em,
  dias_para_gerar_ordem,
  qtd_historico,
  (qtd_historico > 0)                                           AS tem_historico,
  CASE
    WHEN status_raw_eh_final(status_ordem_raw) THEN 0
    ELSE GREATEST((CURRENT_DATE - ordem_detectada_em::date), 0)
  END                                                           AS dias_em_aberto,
  CASE
    WHEN status_raw_eh_final(status_ordem_raw)               THEN 'neutro'
    WHEN GREATEST((CURRENT_DATE - ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((CURRENT_DATE - ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END                                                           AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x.x
    FROM unnest(historico_admin_ids || ARRAY[administrador_id, responsavel_atual_id]) x(x)
    WHERE x.x IS NOT NULL
  )                                                             AS envolvidos_admin_ids,
  descricao,
  tipo_ordem,
  hora_nota,
  concluido_em
FROM base b;

-- ============================================================
-- 2. RPC: qtd_concluidas_30d passa a usar concluido_em
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_admin(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_concluidas_30d INTEGER,
  qtd_canceladas_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tipo_filter AS (
    SELECT v.*
    FROM public.vw_ordens_notas_painel v
    WHERE (
      p_tipo_ordem IS NULL
      OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  ),
  detected AS (
    -- ordens detectadas no período → base para Tratadas, Abertas, Atrasadas
    SELECT * FROM tipo_filter
    WHERE ordem_detectada_em >= p_start_iso
      AND ordem_detectada_em < p_end_exclusive_iso
  ),
  concluidas_periodo AS (
    -- ordens concluídas no período, independente de quando foram abertas
    SELECT
      responsavel_atual_id,
      COUNT(DISTINCT ordem_id)::INTEGER AS qtd
    FROM tipo_filter
    WHERE concluido_em >= p_start_iso
      AND concluido_em < p_end_exclusive_iso
      AND status_ordem = 'concluida'
      AND responsavel_atual_id IS NOT NULL
    GROUP BY responsavel_atual_id
  ),
  ranking AS (
    SELECT
      f.responsavel_atual_id                                    AS administrador_id,
      COALESCE(f.responsavel_atual_nome, 'Sem nome')            AS nome,
      COUNT(DISTINCT f.ordem_id)::INTEGER                       AS qtd_ordens_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.status_ordem = 'aberta'
      )::INTEGER                                                AS qtd_abertas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.status_ordem IN ('em_tratativa', 'desconhecido')
          AND NOT public._is_em_avaliacao(f.status_ordem_raw)
          AND UPPER(TRIM(COALESCE(f.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
      )::INTEGER                                                AS qtd_em_tratativa_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.status_ordem = 'cancelada'
      )::INTEGER                                                AS qtd_canceladas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.semaforo_atraso = 'vermelho'
          AND (
            f.status_ordem = 'aberta'
            OR (
              f.status_ordem IN ('em_tratativa', 'desconhecido')
              AND NOT public._is_avaliada(f.status_ordem_raw)
            )
            OR public._is_em_avaliacao(f.status_ordem_raw)
          )
      )::INTEGER                                                AS qtd_antigas_7d_30d,
      ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
        WHERE f.dias_para_gerar_ordem IS NOT NULL
      ), 2)                                                     AS tempo_medio_geracao_dias_30d
    FROM detected f
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id, f.responsavel_atual_nome
  )
  SELECT
    r.administrador_id,
    r.nome,
    r.qtd_ordens_30d,
    r.qtd_abertas_30d,
    r.qtd_em_tratativa_30d,
    COALESCE(cp.qtd, 0)                                         AS qtd_concluidas_30d,
    r.qtd_canceladas_30d,
    r.qtd_antigas_7d_30d,
    r.tempo_medio_geracao_dias_30d
  FROM ranking r
  LEFT JOIN concluidas_periodo cp ON cp.responsavel_atual_id = r.administrador_id
  ORDER BY COALESCE(cp.qtd, 0) DESC, r.nome ASC;
$$;
