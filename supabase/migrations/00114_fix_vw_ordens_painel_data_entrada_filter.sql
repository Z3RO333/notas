-- Migration 00114: corrige vw_ordens_notas_painel para excluir ordens sem data_entrada
-- Problema: 5.358 ordens PMOS com data_entrada IS NULL e status em_aberto estavam
-- inflando os KPIs (Total: 8.166, Em aberto: 5.358, Atrasadas: 6.863).
-- Ordens sem data_entrada nunca foram confirmadas pelo SAP e não devem aparecer no painel.

CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT na.nota_id,
    count(*) AS qtd_historico,
    array_agg(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM nota_acompanhamentos na
  GROUP BY na.nota_id
), base AS (
  SELECT o.id AS ordem_id,
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
    COALESCE(h.qtd_historico, 0::bigint) AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::uuid[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM ordens_notas_acompanhamento o
    LEFT JOIN notas_manutencao n ON n.id = o.nota_id
    LEFT JOIN administradores origem ON origem.id = o.administrador_id
    LEFT JOIN administradores atual ON atual.id = n.administrador_id
    LEFT JOIN dim_centro_unidade d ON d.centro = o.centro
    LEFT JOIN historico h ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NOT NULL  -- exclui ordens não confirmadas pelo SAP
)
SELECT ordem_id,
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
    WHEN public.status_raw_eh_final(status_ordem_raw) THEN 0
    ELSE GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0)
  END AS dias_em_aberto,
  CASE
    WHEN public.status_raw_eh_final(status_ordem_raw) THEN 'neutro'::text
    WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 7 THEN 'vermelho'::text
    WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 3 THEN 'amarelo'::text
    ELSE 'verde'::text
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x.x
    FROM unnest(b.historico_admin_ids || ARRAY[b.administrador_id, b.responsavel_atual_id]) x(x)
    WHERE x.x IS NOT NULL
  ) AS envolvidos_admin_ids,
  descricao,
  tipo_ordem
FROM base b;
