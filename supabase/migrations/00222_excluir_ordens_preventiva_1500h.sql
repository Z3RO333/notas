-- 00222_excluir_ordens_preventiva_1500h.sql
--
-- Exclui ordens com nota "PREVENTIVA DE 1.500 HORAS" do painel de ordens.
-- A migration 00221 já marcou as notas com exclui_cockpit=true.
-- Aqui adicionamos o filtro na vw_ordens_notas_painel para que ordens
-- vinculadas a essas notas não apareçam no workspace de ordens.

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
    CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
    END AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    public.normalizar_status_ordem(o.status_ordem_raw) AS status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n
    ON n.id = o.nota_id
  LEFT JOIN public.administradores origem
    ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual
    ON atual.id = CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
    END
  LEFT JOIN public.dim_centro_unidade d
    ON d.centro = o.centro
  LEFT JOIN historico h
    ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NOT NULL
    -- Exclui ordens cujas notas estão marcadas como exclui_cockpit
    AND (n.id IS NULL OR n.exclui_cockpit = false)
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
    ELSE GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 'neutro'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
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
