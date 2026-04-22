-- 00239_hora_nota_em_ordens_workspace.sql
--
-- Expõe hora_nota (tempo real do SAP) no painel de ordens.
-- Antes: "Detectada em" mostrava ordem_detectada_em (timestamp do sync).
-- Agora:  hora_nota vem da notas_manutencao e é exibida no drawer.
--
-- Passos:
--   1. Adiciona hora_nota na vw_ordens_notas_painel
--   2. Recria buscar_ordens_workspace com hora_nota no retorno

-- ============================================================
-- 1. View: adiciona n.hora_nota
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
  hora_nota
FROM base b;

-- ============================================================
-- 2. buscar_ordens_workspace: adiciona hora_nota no retorno
-- ============================================================
DROP FUNCTION IF EXISTS public.buscar_ordens_workspace(
  text, integer, integer, timestamptz, timestamptz,
  text, text, text, text, text, uuid,
  timestamptz, uuid, integer, text
);

CREATE OR REPLACE FUNCTION public.buscar_ordens_workspace(
  p_period_mode          TEXT,
  p_year                 INTEGER,
  p_month                INTEGER,
  p_start_iso            TIMESTAMPTZ,
  p_end_exclusive_iso    TIMESTAMPTZ,
  p_status               TEXT,
  p_unidade              TEXT,
  p_responsavel          TEXT,
  p_prioridade           TEXT,
  p_q                    TEXT,
  p_admin_scope          UUID,
  p_cursor_detectada     TIMESTAMPTZ,
  p_cursor_ordem_id      UUID,
  p_limit                INTEGER,
  p_tipo_ordem           TEXT
)
RETURNS TABLE (
  ordem_id               UUID,
  nota_id                UUID,
  numero_nota            TEXT,
  ordem_codigo           TEXT,
  administrador_id       UUID,
  administrador_nome     TEXT,
  responsavel_atual_id   UUID,
  responsavel_atual_nome TEXT,
  centro                 TEXT,
  unidade                TEXT,
  status_ordem           TEXT,
  status_ordem_raw       TEXT,
  ordem_detectada_em     TIMESTAMPTZ,
  status_atualizado_em   TIMESTAMPTZ,
  dias_para_gerar_ordem  INTEGER,
  qtd_historico          BIGINT,
  tem_historico          BOOLEAN,
  dias_em_aberto         INTEGER,
  semaforo_atraso        TEXT,
  envolvidos_admin_ids   UUID[],
  descricao              TEXT,
  tipo_ordem             TEXT,
  hora_nota              TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT *
    FROM public.filtrar_ordens_workspace(
      p_period_mode        => p_period_mode,
      p_year               => p_year,
      p_month              => p_month,
      p_start_iso          => p_start_iso,
      p_end_exclusive_iso  => p_end_exclusive_iso,
      p_status             => p_status,
      p_unidade            => p_unidade,
      p_responsavel        => p_responsavel,
      p_prioridade         => p_prioridade,
      p_q                  => p_q,
      p_admin_scope        => p_admin_scope,
      p_tipo_ordem         => p_tipo_ordem
    )
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
    b.tem_historico,
    b.dias_em_aberto,
    b.semaforo_atraso::TEXT,
    b.envolvidos_admin_ids,
    b.descricao,
    b.tipo_ordem,
    nm.hora_nota
  FROM base b
  LEFT JOIN public.notas_manutencao nm ON nm.id = b.nota_id
  WHERE
    p_cursor_detectada IS NULL
    OR (
      (b.ordem_detectada_em, b.ordem_id) <
      (p_cursor_detectada, COALESCE(p_cursor_ordem_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID))
    )
  ORDER BY b.ordem_detectada_em DESC, b.ordem_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;
