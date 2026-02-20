-- 00027_remove_capacity_pressure_and_fix_kpis.sql
-- Remove dependencia operacional de max_notas e corrige agregacoes de KPI

-- ============================================================
-- 1) DISTRIBUICAO SEM CAP DE max_notas
-- ============================================================
CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
  v_especialidade TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NULL
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n
        ON n.administrador_id = a.id
      WHERE a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.nome
      ORDER BY open_count ASC, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN
      EXIT;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2) KPI DASHBOARD COM CONCLUSAO DEDUPLICADA
-- ============================================================
CREATE OR REPLACE VIEW public.vw_dashboard_fluxo_diario_90d AS
WITH dias AS (
  SELECT
    generate_series(
      (current_date - INTERVAL '89 days')::date,
      current_date::date,
      INTERVAL '1 day'
    )::date AS dia
),
entradas AS (
  SELECT
    COALESCE(n.data_criacao_sap, n.created_at::date) AS dia,
    COUNT(*)::BIGINT AS qtd_entradas
  FROM public.notas_manutencao n
  WHERE COALESCE(n.data_criacao_sap, n.created_at::date)
    BETWEEN (current_date - INTERVAL '89 days')::date AND current_date::date
  GROUP BY 1
),
conclusoes_unicas AS (
  SELECT
    h.nota_id,
    MIN(h.created_at::date) AS dia
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
  GROUP BY h.nota_id
),
concluidas AS (
  SELECT
    c.dia,
    COUNT(*)::BIGINT AS qtd_concluidas
  FROM conclusoes_unicas c
  WHERE c.dia BETWEEN (current_date - INTERVAL '89 days')::date AND current_date::date
  GROUP BY c.dia
)
SELECT
  d.dia,
  COALESCE(e.qtd_entradas, 0)::BIGINT AS qtd_entradas,
  COALESCE(c.qtd_concluidas, 0)::BIGINT AS qtd_concluidas
FROM dias d
LEFT JOIN entradas e ON e.dia = d.dia
LEFT JOIN concluidas c ON c.dia = d.dia
ORDER BY d.dia;

CREATE OR REPLACE VIEW public.vw_dashboard_produtividade_60d AS
WITH periodo AS (
  SELECT
    (current_date - INTERVAL '29 days')::date AS inicio_atual,
    current_date::date AS fim_atual,
    (current_date - INTERVAL '59 days')::date AS inicio_anterior,
    (current_date - INTERVAL '30 days')::date AS fim_anterior
),
conclusoes_unicas AS (
  SELECT
    h.nota_id,
    n.administrador_id,
    MIN(h.created_at::date) AS dia
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at::date BETWEEN (current_date - INTERVAL '59 days')::date AND current_date::date
    AND n.administrador_id IS NOT NULL
  GROUP BY h.nota_id, n.administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COUNT(*) FILTER (
    WHERE c.dia BETWEEN p.inicio_atual AND p.fim_atual
  )::BIGINT AS concluidas_30d,
  COUNT(*) FILTER (
    WHERE c.dia BETWEEN p.inicio_anterior AND p.fim_anterior
  )::BIGINT AS concluidas_prev_30d
FROM public.administradores a
CROSS JOIN periodo p
LEFT JOIN conclusoes_unicas c ON c.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY
  a.id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  p.inicio_atual,
  p.fim_atual,
  p.inicio_anterior,
  p.fim_anterior;

-- ============================================================
-- 3) PRODUTIVIDADE DETALHADA COM CONCLUSAO DEDUPLICADA
-- ============================================================
CREATE OR REPLACE VIEW public.vw_produtividade_detalhada AS
WITH conclusoes_unicas AS (
  SELECT
    h.nota_id,
    n.administrador_id,
    MIN(h.created_at) AS concluida_em
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= NOW() - INTERVAL '60 days'
    AND n.administrador_id IS NOT NULL
  GROUP BY h.nota_id, n.administrador_id
),
agg AS (
  SELECT
    administrador_id,
    COUNT(*) FILTER (WHERE concluida_em >= NOW() - INTERVAL '7 days')::INT AS concluidas_7d,
    COUNT(*) FILTER (WHERE concluida_em >= NOW() - INTERVAL '30 days')::INT AS concluidas_30d,
    COUNT(*) FILTER (
      WHERE concluida_em >= NOW() - INTERVAL '60 days'
        AND concluida_em < NOW() - INTERVAL '30 days'
    )::INT AS concluidas_prev_30d
  FROM conclusoes_unicas
  GROUP BY administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COALESCE(agg.concluidas_7d, 0) AS concluidas_7d,
  COALESCE(agg.concluidas_30d, 0) AS concluidas_30d,
  COALESCE(agg.concluidas_prev_30d, 0) AS concluidas_prev_30d,
  ROUND(COALESCE(agg.concluidas_30d, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  CASE
    WHEN COALESCE(agg.concluidas_prev_30d, 0) > 0
      THEN ROUND(
        ((COALESCE(agg.concluidas_30d, 0) - COALESCE(agg.concluidas_prev_30d, 0))::NUMERIC
        / agg.concluidas_prev_30d) * 100, 1
      )
    ELSE 0
  END AS variacao_pct,
  CASE
    WHEN (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)) > 0
      THEN ROUND(
        COALESCE(agg.concluidas_30d, 0)::NUMERIC
        / (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)), 3
      )
    ELSE 0
  END AS eficiencia
FROM public.administradores a
LEFT JOIN agg ON agg.administrador_id = a.id
LEFT JOIN public.vw_carga_administradores c ON c.id = a.id
WHERE a.role = 'admin'
  AND (a.recebe_distribuicao OR COALESCE(agg.concluidas_30d, 0) > 0)
ORDER BY COALESCE(agg.concluidas_30d, 0) DESC;

-- ============================================================
-- 4) ISO POR ADMIN SEM DEPENDENCIA DE max_notas
-- ============================================================
CREATE OR REPLACE VIEW public.vw_iso_por_admin AS
WITH admin_base AS (
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade,
    a.max_notas,
    a.ativo,
    a.recebe_distribuicao,
    a.em_ferias,
    COALESCE(c.qtd_abertas, 0)::INT AS qtd_abertas
  FROM public.administradores a
  LEFT JOIN public.vw_carga_administradores c ON c.id = a.id
  WHERE a.role = 'admin'
),
team_avg AS (
  SELECT
    AVG(ab.qtd_abertas)::NUMERIC AS media_abertas_ativas
  FROM admin_base ab
  WHERE ab.ativo = true
    AND ab.recebe_distribuicao = true
    AND ab.em_ferias = false
),
nota_aging AS (
  SELECT
    n.administrador_id,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 4 THEN 100
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 3 THEN 80
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 2 THEN 60
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 1 THEN 30
      ELSE 0
    END AS peso,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 3 THEN 1
      ELSE 0
    END AS is_critico
  FROM public.notas_manutencao n
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND n.administrador_id IS NOT NULL
),
nota_agg AS (
  SELECT
    administrador_id,
    COALESCE(AVG(peso), 0) AS nota_severity,
    COALESCE(SUM(is_critico), 0)::INT AS qtd_notas_criticas
  FROM nota_aging
  GROUP BY administrador_id
),
ordem_agg AS (
  SELECT
    o.administrador_id,
    COUNT(*) FILTER (WHERE o.semaforo_atraso = 'vermelho') AS qtd_vermelhas,
    COUNT(*) AS qtd_total
  FROM public.vw_ordens_notas_painel o
  WHERE o.administrador_id IS NOT NULL
    AND o.status_ordem NOT IN ('concluida', 'cancelada')
  GROUP BY o.administrador_id
),
componentes AS (
  SELECT
    ab.administrador_id,
    ab.nome,
    ab.avatar_url,
    ab.especialidade,
    ab.qtd_abertas,
    ab.max_notas,
    ROUND(COALESCE(na.nota_severity, 0)::NUMERIC, 1) AS nota_severity,
    ROUND(
      CASE WHEN COALESCE(oa.qtd_total, 0) > 0
        THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100
        ELSE 0
      END,
      1
    ) AS order_severity,
    ROUND(
      LEAST(
        CASE
          WHEN COALESCE(ta.media_abertas_ativas, 0) > 0
            THEN (ab.qtd_abertas::NUMERIC / ta.media_abertas_ativas) * 100
          WHEN ab.qtd_abertas > 0 THEN 100
          ELSE 0
        END,
        200
      ),
      1
    ) AS workload_pressure,
    ROUND(
      CASE WHEN ab.qtd_abertas > 0
        THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100
        ELSE 0
      END,
      1
    ) AS critical_density,
    COALESCE(na.qtd_notas_criticas, 0)::INT AS qtd_notas_criticas,
    COALESCE(oa.qtd_vermelhas, 0)::INT AS qtd_ordens_vermelhas,
    ab.recebe_distribuicao,
    ab.em_ferias
  FROM admin_base ab
  CROSS JOIN team_avg ta
  LEFT JOIN nota_agg na ON na.administrador_id = ab.administrador_id
  LEFT JOIN ordem_agg oa ON oa.administrador_id = ab.administrador_id
),
score AS (
  SELECT
    c.*,
    ROUND(
      (
        c.nota_severity * 0.25
        + c.order_severity * 0.25
        + c.workload_pressure * 0.25
        + c.critical_density * 0.25
      )::NUMERIC,
      1
    ) AS iso_score
  FROM componentes c
)
SELECT
  s.administrador_id,
  s.nome,
  s.avatar_url,
  s.especialidade,
  s.nota_severity,
  s.order_severity,
  s.workload_pressure,
  s.critical_density,
  s.iso_score,
  CASE
    WHEN s.iso_score >= 75 THEN 'critico'
    WHEN s.iso_score >= 50 THEN 'risco_alto'
    WHEN s.iso_score >= 25 THEN 'atencao'
    ELSE 'saudavel'
  END AS iso_faixa,
  s.qtd_abertas,
  s.max_notas,
  s.qtd_notas_criticas,
  s.qtd_ordens_vermelhas
FROM score s
WHERE s.qtd_abertas > 0 OR s.recebe_distribuicao OR s.em_ferias
ORDER BY s.iso_score DESC;

-- ============================================================
-- 5) RADAR DE CARGA RELATIVA (SEM max_notas)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_radar_colaborador AS
WITH conclusoes_unicas AS (
  SELECT
    h.nota_id,
    n.administrador_id,
    MIN(h.created_at) AS concluida_em
  FROM public.notas_historico h
  JOIN public.notas_manutencao n ON n.id = h.nota_id
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'concluida'
    AND h.created_at >= NOW() - INTERVAL '30 days'
    AND n.administrador_id IS NOT NULL
  GROUP BY h.nota_id, n.administrador_id
),
concluidas_7d AS (
  SELECT
    administrador_id,
    COUNT(*)::INT AS qtd
  FROM conclusoes_unicas
  WHERE concluida_em >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
),
concluidas_30d AS (
  SELECT
    administrador_id,
    COUNT(*)::INT AS qtd
  FROM conclusoes_unicas
  GROUP BY administrador_id
)
SELECT
  iso.administrador_id,
  iso.nome,
  iso.avatar_url,
  iso.especialidade,
  iso.iso_score,
  iso.iso_faixa,
  iso.qtd_abertas,
  iso.max_notas,
  iso.workload_pressure AS pct_carga,
  CASE
    WHEN iso.workload_pressure >= 130 THEN 'sobrecarregado'
    WHEN iso.workload_pressure >= 100 THEN 'carregado'
    WHEN iso.workload_pressure >= 60 THEN 'equilibrado'
    ELSE 'ocioso'
  END AS workload_status,
  iso.qtd_notas_criticas,
  iso.qtd_ordens_vermelhas,
  COALESCE(c7.qtd, 0) AS concluidas_7d,
  COALESCE(c30.qtd, 0) AS concluidas_30d,
  ROUND(COALESCE(c30.qtd, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  a.em_ferias,
  a.recebe_distribuicao
FROM public.vw_iso_por_admin iso
JOIN public.administradores a ON a.id = iso.administrador_id
LEFT JOIN concluidas_7d c7 ON c7.administrador_id = iso.administrador_id
LEFT JOIN concluidas_30d c30 ON c30.administrador_id = iso.administrador_id
ORDER BY iso.iso_score DESC;
