-- 00265_ranking_excluir_admins_cd.sql
--
-- Remove admins de CD do ranking de produtividade.
-- CD (Adriano/cd_taruma, Brenda/cd_manaus, Daniel/cd_manaus_equip) operam com
-- volume muito diferente dos demais, tornando a comparação injusta.
-- Filtro por especialidade → automático para futuros admins de CD.

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
  WITH cd_admins AS (
    SELECT id FROM public.administradores
    WHERE especialidade IN ('cd_taruma', 'cd_manaus', 'cd_manaus_equip')
  ),
  tipo_filter AS (
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
  WHERE r.administrador_id NOT IN (SELECT id FROM cd_admins)
  ORDER BY COALESCE(cp.qtd, 0) DESC, r.nome ASC;
$$;
