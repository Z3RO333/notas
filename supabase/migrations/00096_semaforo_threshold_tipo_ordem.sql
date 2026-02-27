-- 00096_semaforo_threshold_tipo_ordem.sql
-- Corrige semaforo_atraso em vw_ordens_notas_painel para respeitar tipo de ordem:
--   - PMPL: manutenção planejada com ciclo longo → semáforo sempre 'verde' (nunca atrasada)
--   - PMOS EQUIPAMENTO_EM_CONSERTO / ENVIAR_EMAIL_PFORNECEDOR: threshold 21d vermelho / 10d amarelo
--   - PMOS outros: mantém 7d vermelho / 3d amarelo (comportamento anterior)
-- Também mapeia EXECUCAO_INSATISFATORIO → 'em_tratativa' em normalizar_status_ordem.

-- ─── 1. Recria vw_ordens_notas_painel com semáforo diferenciado ───────────────

CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT na.nota_id,
    count(*) AS qtd_historico,
    array_agg(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM nota_acompanhamentos na
  GROUP BY na.nota_id
), base AS (
  SELECT
    o.id            AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome     AS administrador_nome,
    -- responsavel_atual: nota atual > ordem original > criador SAP
    COALESCE(n.administrador_id, o.administrador_id, o.criado_por) AS responsavel_atual_id,
    atual.nome      AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade)  AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    o.data_entrada  AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico,  0::bigint)       AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::uuid[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem,
    o.criado_por
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n       ON n.id       = o.nota_id
  LEFT JOIN public.administradores origem   ON origem.id  = o.administrador_id
  LEFT JOIN public.administradores atual    ON atual.id   = COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
  LEFT JOIN public.dim_centro_unidade d     ON d.centro   = o.centro
  LEFT JOIN historico h                     ON h.nota_id  = o.nota_id
  WHERE o.data_entrada IS NOT NULL
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
  qtd_historico > 0 AS tem_historico,
  CASE
    WHEN status_ordem = ANY (ARRAY['concluida'::public.ordem_status_acomp, 'cancelada'::public.ordem_status_acomp]) THEN 0
    ELSE GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0)
  END AS dias_em_aberto,
  CASE
    WHEN status_ordem = ANY (ARRAY['concluida'::public.ordem_status_acomp, 'cancelada'::public.ordem_status_acomp]) THEN 'neutro'
    -- PMPL: manutenção planejada, ciclo longo — semáforo sempre verde
    WHEN tipo_ordem = 'PMPL' THEN 'verde'
    -- PMOS equipamento em conserto externo / aguardando fornecedor: threshold estendido
    WHEN status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'ENVIAR_EMAIL_PFORNECEDOR') THEN
      CASE
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 21 THEN 'vermelho'
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 10 THEN 'amarelo'
        ELSE 'verde'
      END
    -- PMOS outros: threshold original (7d vermelho, 3d amarelo)
    ELSE
      CASE
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 7 THEN 'vermelho'
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 3 THEN 'amarelo'
        ELSE 'verde'
      END
  END AS semaforo_atraso,
  -- envolvidos: inclui criado_por no array
  ARRAY(
    SELECT DISTINCT x.x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id, b.criado_por]
    ) x(x)
    WHERE x.x IS NOT NULL
  ) AS envolvidos_admin_ids,
  descricao,
  tipo_ordem
FROM base b;

-- ─── 2. Atualiza normalizar_status_ordem: mapeia EXECUCAO_INSATISFATORIO ──────

CREATE OR REPLACE FUNCTION public.normalizar_status_ordem(p_raw text)
  RETURNS ordem_status_acomp
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'public'
AS $$
DECLARE v_raw TEXT := UPPER(BTRIM(COALESCE(p_raw, '')));
BEGIN
  IF v_raw = '' THEN RETURN 'desconhecido'; END IF;
  IF v_raw IN ('ABERTO') THEN RETURN 'aberta'; END IF;
  IF v_raw IN (
    'EM_PROCESSAMENTO', 'EM_EXECUCAO', 'AVALIACAO_DA_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO', 'EXECUCAO_NAO_REALIZADA', 'ENVIAR_EMAIL_PFORNECEDOR',
    'EXECUCAO_INSATISFATORIO'
  ) THEN RETURN 'em_tratativa'; END IF;
  IF v_raw IN ('CONCLUIDO', 'AGUARDANDO_FATURAMENTO_NF', 'EXECUCAO_SATISFATORIO')
    THEN RETURN 'concluida'; END IF;
  IF v_raw = 'CANCELADO' THEN RETURN 'cancelada'; END IF;
  RETURN 'desconhecido';
END;
$$;
