-- 00113_orders_status_raw_workspace_consistency.sql
-- Consolida semantica de status do Painel de Ordens para usar somente status_ordem_raw.
-- Escopo:
-- - vw_ordens_notas_painel (dias_em_aberto e semaforo por RAW)
-- - filtrar_ordens_workspace
-- - calcular_kpis_ordens_operacional
-- - calcular_resumo_colaboradores_ordens
-- - buscar_ordens_prioritarias_dashboard
-- - calcular_ranking_ordens_admin / calcular_ranking_ordens_unidade

CREATE OR REPLACE FUNCTION public.classificar_status_ordem_raw(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(BTRIM(COALESCE(p_raw, '')))
    WHEN 'ABERTO' THEN 'em_aberto'
    WHEN 'ABERTA' THEN 'em_aberto'
    WHEN 'EM_PROCESSAMENTO' THEN 'em_aberto'

    WHEN 'EM_EXECUCAO' THEN 'em_execucao'
    WHEN 'EQUIPAMENTO_EM_CONSERTO' THEN 'em_execucao'
    WHEN 'ENVIAR_EMAIL_PFORNECEDOR' THEN 'em_execucao'
    WHEN 'EXECUCAO_INSATISFATORIO' THEN 'em_execucao'

    WHEN 'AVALIACAO_DA_EXECUCAO' THEN 'em_avaliacao'
    WHEN 'AVALIACAO_DE_EXECUCAO' THEN 'em_avaliacao'

    WHEN 'EXECUCAO_SATISFATORIO' THEN 'avaliada'
    WHEN 'EXECUCAO_SATISFATORIA' THEN 'avaliada'

    WHEN 'EXECUCAO_NAO_REALIZADA' THEN 'nao_realizada'

    WHEN 'CONCLUIDO' THEN 'concluida'
    WHEN 'CONCLUIDA' THEN 'concluida'
    WHEN 'AGUARDANDO_FATURAMENTO_NF' THEN 'concluida'

    WHEN 'CANCELADO' THEN 'cancelada'
    WHEN 'CANCELADA' THEN 'cancelada'

    ELSE 'desconhecido'
  END;
$$;

CREATE OR REPLACE FUNCTION public.status_raw_eh_ativo(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.classificar_status_ordem_raw(p_raw) IN (
    'em_aberto',
    'em_execucao',
    'em_avaliacao',
    'nao_realizada',
    'desconhecido'
  );
$$;

CREATE OR REPLACE FUNCTION public.status_raw_eh_final(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.classificar_status_ordem_raw(p_raw) IN ('avaliada', 'concluida', 'cancelada');
$$;

CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
base AS (
  SELECT
    o.id AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome AS administrador_nome,
    n.administrador_id AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
  LEFT JOIN public.administradores origem ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual ON atual.id = n.administrador_id
  LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
  LEFT JOIN historico h ON h.nota_id = o.nota_id
)
SELECT
  b.ordem_id,
  b.nota_id,
  b.numero_nota,
  b.ordem_codigo,
  b.administrador_id,
  b.administrador_nome,
  b.responsavel_atual_id,
  b.responsavel_atual_nome,
  b.centro,
  b.unidade,
  b.status_ordem,
  b.status_ordem_raw,
  b.ordem_detectada_em,
  b.status_atualizado_em,
  b.dias_para_gerar_ordem,
  b.qtd_historico,
  (b.qtd_historico > 0) AS tem_historico,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 0
    ELSE GREATEST((current_date - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 'neutro'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id]
    ) AS x
    WHERE x IS NOT NULL
  ) AS envolvidos_admin_ids,
  b.descricao,
  b.tipo_ordem
FROM base b;

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace(
  p_period_mode          TEXT    DEFAULT 'all',
  p_year                 INTEGER DEFAULT NULL,
  p_month                INTEGER DEFAULT NULL,
  p_start_iso            TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso    TIMESTAMPTZ DEFAULT NULL,
  p_status               TEXT    DEFAULT NULL,
  p_unidade              TEXT    DEFAULT NULL,
  p_responsavel          TEXT    DEFAULT NULL,
  p_prioridade           TEXT    DEFAULT NULL,
  p_q                    TEXT    DEFAULT NULL,
  p_admin_scope          UUID    DEFAULT NULL,
  p_tipo_ordem           TEXT    DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  WHERE
    (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)
    AND (
      COALESCE(p_period_mode, 'all') = 'all'
      OR (
        p_period_mode = 'year'
        AND p_year IS NOT NULL
        AND EXTRACT(YEAR FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_year
      )
      OR (
        p_period_mode = 'year_month'
        AND p_year IS NOT NULL
        AND p_month IS NOT NULL
        AND EXTRACT(YEAR FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_year
        AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_month
      )
      OR (
        p_period_mode = 'month'
        AND p_month IS NOT NULL
        AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_month
      )
      OR (
        p_period_mode = 'range'
        AND p_start_iso IS NOT NULL
        AND p_end_exclusive_iso IS NOT NULL
        AND v.ordem_detectada_em >= p_start_iso
        AND v.ordem_detectada_em < p_end_exclusive_iso
      )
    )
    AND (
      p_status IS NULL
      OR p_status = ''
      OR p_status = 'todas'
      OR (p_status = 'aberta' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'em_aberto')
      OR (p_status = 'em_tratativa' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'em_execucao')
      OR (p_status = 'em_avaliacao' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'em_avaliacao')
      OR (p_status = 'avaliadas' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'avaliada')
      OR (p_status = 'nao_realizada' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'nao_realizada')
      OR (p_status = 'concluida' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'concluida')
      OR (p_status = 'cancelada' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'cancelada')
      OR (p_status = 'desconhecido' AND public.classificar_status_ordem_raw(v.status_ordem_raw) = 'desconhecido')
      OR (
        p_status NOT IN ('aberta', 'em_tratativa', 'em_avaliacao', 'avaliadas', 'nao_realizada', 'concluida', 'cancelada', 'desconhecido')
        AND v.status_ordem::TEXT = p_status
      )
    )
    AND (
      p_unidade IS NULL
      OR p_unidade = ''
      OR p_unidade = 'todas'
      OR v.unidade = p_unidade
    )
    AND (
      p_responsavel IS NULL
      OR p_responsavel = ''
      OR p_responsavel = 'todos'
      OR (
        p_responsavel = '__sem_atual__'
        AND v.responsavel_atual_id IS NULL
      )
      OR (
        p_responsavel <> '__sem_atual__'
        AND v.responsavel_atual_id::TEXT = p_responsavel
      )
    )
    AND (
      p_prioridade IS NULL
      OR p_prioridade = ''
      OR p_prioridade = 'todas'
      OR v.semaforo_atraso = p_prioridade
    )
    AND (
      p_q IS NULL
      OR p_q = ''
      OR v.numero_nota ILIKE ('%' || p_q || '%')
      OR v.ordem_codigo ILIKE ('%' || p_q || '%')
      OR COALESCE(v.descricao, '') ILIKE ('%' || p_q || '%')
    )
    AND (
      p_tipo_ordem IS NULL
      OR p_tipo_ordem = ''
      OR p_tipo_ordem = 'todas'
      OR (p_tipo_ordem = 'PMPL' AND v.tipo_ordem = 'PMPL')
      OR (p_tipo_ordem = 'PMOS' AND v.tipo_ordem = 'PMOS')
    );
$$;

CREATE OR REPLACE FUNCTION public.calcular_kpis_ordens_operacional(
  p_period_mode TEXT DEFAULT 'all',
  p_year INTEGER DEFAULT NULL,
  p_month INTEGER DEFAULT NULL,
  p_start_iso TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_unidade TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prioridade TEXT DEFAULT NULL,
  p_q TEXT DEFAULT NULL,
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace(
      p_period_mode => p_period_mode,
      p_year => p_year,
      p_month => p_month,
      p_start_iso => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status => p_status,
      p_unidade => p_unidade,
      p_responsavel => p_responsavel,
      p_prioridade => p_prioridade,
      p_q => p_q,
      p_admin_scope => p_admin_scope,
      p_tipo_ordem => p_tipo_ordem
    )
  ),
  classified AS (
    SELECT
      f.*,
      public.classificar_status_ordem_raw(f.status_ordem_raw) AS raw_bucket
    FROM filtered f
  )
  SELECT json_build_object(
    'total',          COUNT(DISTINCT ordem_id)::INTEGER,
    'abertas',        COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
    'em_tratativa',   COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
    'em_avaliacao',   COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
    'concluidas',     COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
    'canceladas',     COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
    'avaliadas',      COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
    'atrasadas',      COUNT(DISTINCT ordem_id) FILTER (
                        WHERE semaforo_atraso = 'vermelho'
                          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
                      )::INTEGER,
    'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (
                         WHERE responsavel_atual_id IS NULL
                           AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
                       )::INTEGER
  )
  FROM classified;
$$;

DROP FUNCTION IF EXISTS public.calcular_resumo_colaboradores_ordens(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
);

CREATE OR REPLACE FUNCTION public.calcular_resumo_colaboradores_ordens(
  p_period_mode TEXT DEFAULT 'all',
  p_year INTEGER DEFAULT NULL,
  p_month INTEGER DEFAULT NULL,
  p_start_iso TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_unidade TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prioridade TEXT DEFAULT NULL,
  p_q TEXT DEFAULT NULL,
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  avatar_url TEXT,
  total INTEGER,
  abertas INTEGER,
  recentes INTEGER,
  atencao INTEGER,
  atrasadas INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      f.*,
      public.classificar_status_ordem_raw(f.status_ordem_raw) AS raw_bucket
    FROM public.filtrar_ordens_workspace(
      p_period_mode => p_period_mode,
      p_year => p_year,
      p_month => p_month,
      p_start_iso => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status => p_status,
      p_unidade => p_unidade,
      p_responsavel => p_responsavel,
      p_prioridade => p_prioridade,
      p_q => p_q,
      p_admin_scope => p_admin_scope,
      p_tipo_ordem => p_tipo_ordem
    ) f
  ),
  admins AS (
    SELECT a.id, a.nome, a.avatar_url
    FROM public.administradores a
    WHERE a.ativo = true
      AND (
        a.role = 'admin'
        OR (
          a.role = 'gestor'
          AND EXISTS (
            SELECT 1
            FROM filtered f
            WHERE f.responsavel_atual_id = a.id
              AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          )
          AND (
            (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) = 'PMPL'
              AND LOWER(a.email) = 'gustavoandrade@bemol.com.br'
            )
            OR (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) <> 'PMPL'
              AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br', 'danieldamasceno@bemol.com.br')
            )
          )
        )
      )
      AND (p_admin_scope IS NULL OR a.id = p_admin_scope)
  ),
  por_admin AS (
    SELECT
      a.id AS administrador_id,
      a.nome,
      a.avatar_url,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS total,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'vermelho'
      )::INTEGER AS atrasadas
    FROM admins a
    LEFT JOIN filtered f
      ON f.responsavel_atual_id = a.id
    GROUP BY a.id, a.nome, a.avatar_url
  ),
  sem_responsavel AS (
    SELECT
      NULL::UUID AS administrador_id,
      'Sem responsavel'::TEXT AS nome,
      NULL::TEXT AS avatar_url,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS total,
      COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'vermelho'
      )::INTEGER AS atrasadas
    FROM filtered
    WHERE responsavel_atual_id IS NULL
      AND p_admin_scope IS NULL
  )
  SELECT *
  FROM por_admin
  UNION ALL
  SELECT *
  FROM sem_responsavel
  WHERE total > 0
  ORDER BY total DESC, nome ASC;
$$;

DROP FUNCTION IF EXISTS public.buscar_ordens_prioritarias_dashboard(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.buscar_ordens_prioritarias_dashboard(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.buscar_ordens_prioritarias_dashboard(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_limit             INTEGER DEFAULT 20,
  p_tipo_ordem        TEXT DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  JOIN public.ordens_notas_acompanhamento o ON o.id = v.ordem_id
  WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) >= p_start_iso
    AND COALESCE(o.data_entrada, o.ordem_detectada_em) < p_end_exclusive_iso
    AND (
      p_tipo_ordem IS NULL
      OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  ORDER BY
    CASE v.semaforo_atraso
      WHEN 'vermelho' THEN 3
      WHEN 'amarelo' THEN 2
      WHEN 'verde' THEN 1
      ELSE 0
    END DESC,
    CASE
      WHEN public.status_raw_eh_final(v.status_ordem_raw) THEN 0
      ELSE 1
    END DESC,
    COALESCE(o.data_entrada, o.ordem_detectada_em) DESC,
    v.ordem_codigo ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 1000);
$$;

DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_admin(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_admin(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

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
  WITH filtered AS (
    SELECT
      v.*,
      public.classificar_status_ordem_raw(v.status_ordem_raw) AS raw_bucket
    FROM public.vw_ordens_notas_painel v
    WHERE v.ordem_detectada_em >= p_start_iso
      AND v.ordem_detectada_em < p_end_exclusive_iso
      AND (
        p_tipo_ordem IS NULL
        OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
        OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
      )
  )
  SELECT
    f.responsavel_atual_id AS administrador_id,
    COALESCE(f.responsavel_atual_nome, 'Sem nome') AS nome,
    COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS qtd_abertas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER AS qtd_em_tratativa_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER AS qtd_concluidas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'cancelada')::INTEGER AS qtd_canceladas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.semaforo_atraso = 'vermelho'
        AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER AS qtd_antigas_7d_30d,
    ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
      WHERE f.dias_para_gerar_ordem IS NOT NULL
    ), 2) AS tempo_medio_geracao_dias_30d
  FROM filtered f
  WHERE f.responsavel_atual_id IS NOT NULL
  GROUP BY f.responsavel_atual_id, f.responsavel_atual_nome
  ORDER BY qtd_ordens_30d DESC, nome ASC;
$$;

DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_unidade(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_unidade(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_unidade(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  unidade TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      v.*,
      public.classificar_status_ordem_raw(v.status_ordem_raw) AS raw_bucket
    FROM public.vw_ordens_notas_painel v
    WHERE v.ordem_detectada_em >= p_start_iso
      AND v.ordem_detectada_em < p_end_exclusive_iso
      AND (
        p_tipo_ordem IS NULL
        OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
        OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
      )
  )
  SELECT
    COALESCE(f.unidade, 'Sem unidade') AS unidade,
    COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS qtd_abertas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER AS qtd_em_tratativa_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.semaforo_atraso = 'vermelho'
        AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER AS qtd_antigas_7d_30d,
    ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
      WHERE f.dias_para_gerar_ordem IS NOT NULL
    ), 2) AS tempo_medio_geracao_dias_30d
  FROM filtered f
  GROUP BY COALESCE(f.unidade, 'Sem unidade')
  ORDER BY qtd_ordens_30d DESC, unidade ASC;
$$;
