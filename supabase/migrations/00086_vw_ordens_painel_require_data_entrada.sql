-- 00086_vw_ordens_painel_require_data_entrada.sql
--
-- PROBLEMA: vw_ordens_notas_painel usa COALESCE(o.data_entrada, o.ordem_detectada_em)
-- para o campo ordem_detectada_em. Ordens bootstrap (criadas localmente de notas com
-- ordem_sap, sem confirmação do sync PMPL/PMOS) têm data_entrada=NULL e status='ABERTO'
-- como padrão. Isso faz 5.358 PMOS + 87 PMPL aparecerem no painel como ordens de 2026
-- quando na realidade nunca foram confirmadas pelo SAP.
--
-- FIX: adicionar WHERE o.data_entrada IS NOT NULL na base da view.
-- Garante que o painel só mostre ordens cujo status veio do sync PMPL/PMOS real.
-- Ordens bootstrap aguardam enriquecimento e permanecem invisíveis até serem confirmadas.

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
    COALESCE(n.administrador_id, o.administrador_id) AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    o.data_entrada AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
  LEFT JOIN public.administradores origem ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual ON atual.id = COALESCE(n.administrador_id, o.administrador_id)
  LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
  LEFT JOIN historico h ON h.nota_id = o.nota_id
  -- Exige data_entrada: garante que só ordens confirmadas pelo sync PMPL/PMOS apareçam.
  -- Ordens bootstrap (data_entrada IS NULL) aguardam enriquecimento e ficam invisíveis.
  WHERE o.data_entrada IS NOT NULL
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
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 0
    ELSE GREATEST((current_date - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 'neutro'
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

COMMENT ON VIEW public.vw_ordens_notas_painel IS
  'Painel de ordens. Inclui APENAS ordens com data_entrada IS NOT NULL (confirmadas pelo sync PMPL/PMOS). '
  'Ordens bootstrap (data_entrada=NULL) são invisíveis até serem enriquecidas pelo sync job. '
  'ordem_detectada_em = data_entrada (data SAP real, não fallback interno).';
