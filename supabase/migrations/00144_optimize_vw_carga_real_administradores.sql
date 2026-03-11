-- 00144_optimize_vw_carga_real_administradores.sql
--
-- Problema:
--   vw_carga_real_administradores está causando statement_timeout (57014) no PostgREST
--   e no Painel de Notas. O EXPLAIN ANALYZE em si dá timeout.
--
-- Causa raiz:
--   A view anterior faz um join explosion:
--     administradores → notas_manutencao → ordens_notas_acompanhamento
--                     → o_active (subquery) → vw_notas_status_sap_aux_latest
--   Antes da agregação GROUP BY, o produto cartesiano pode gerar milhões de
--   linhas intermediárias (ordens × notas × admins).
--
-- Solução:
--   Reescrever com CTEs que pré-agregam por administrador_id antes de juntar.
--   Cada CTE opera sobre uma única tabela e agrega counts independentemente:
--     1. notas_abertas_agg  — notas nova/em_andamento/encaminhada sem ordem ativa/SAP final
--     2. notas_concluidas_agg — contagem simples de notas concluidas
--     3. ordens_ativas_agg  — ordens com status ativo por admin
--   O SELECT final é um join simples entre administradores e 3 linhas agregadas.
--
-- Índice auxiliar:
--   O join com vw_notas_status_sap_aux_latest usa a expressão
--   COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
--   que não pode usar o índice em numero_nota. Adicionamos um índice funcional
--   para que o hash join use uma varredura indexada na lateral do probe.

-- ============================================================
-- 1) Índice funcional para o join notas → sap_aux (se não existir)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_notas_manutencao_numero_nota_norm
  ON public.notas_manutencao (
    (COALESCE(NULLIF(ltrim(btrim(numero_nota), '0'), ''), '0'))
  );

-- Índice composto para filtro de abertas (admin + status + ordem_sap nulo)
CREATE INDEX IF NOT EXISTS idx_notas_manutencao_admin_status_sem_ordem
  ON public.notas_manutencao (administrador_id, status)
  WHERE ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000');

-- Índice para o subquery o_active
CREATE INDEX IF NOT EXISTS idx_ordens_notas_status_ativo_nota_id
  ON public.ordens_notas_acompanhamento (nota_id)
  WHERE status_ordem NOT IN ('concluida', 'cancelada');

-- ============================================================
-- 2) View reescrita com CTEs pré-agregados
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_real_administradores AS
WITH
-- Subconjunto de notas com ordem ativa no cockpit (para exclusão de abertas)
ordens_ativas_ids AS (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE status_ordem NOT IN ('concluida', 'cancelada')
    AND nota_id IS NOT NULL
),
-- Notas abertas elegíveis (mesmos filtros de vw_notas_sem_ordem) agregadas por admin
notas_abertas_agg AS (
  SELECT
    n.administrador_id,
    COUNT(*) FILTER (WHERE n.status = 'nova')                    AS qtd_nova,
    COUNT(*) FILTER (WHERE n.status = 'em_andamento')            AS qtd_em_andamento,
    COUNT(*) FILTER (WHERE n.status = 'encaminhada_fornecedor')  AS qtd_encaminhada,
    COUNT(*)                                                      AS qtd_abertas
  FROM public.notas_manutencao n
  LEFT JOIN ordens_ativas_ids oa
    ON oa.nota_id = n.id
  LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
    ON sap_aux.numero_nota_norm
       = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
  WHERE n.administrador_id IS NOT NULL
    AND n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
    AND oa.nota_id IS NULL
    AND (sap_aux.status_canonico IS NULL
         OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
  GROUP BY n.administrador_id
),
-- Notas concluídas (sem filtro de ordem/SAP — mesmo comportamento original)
notas_concluidas_agg AS (
  SELECT administrador_id, COUNT(*) AS qtd_concluidas
  FROM public.notas_manutencao
  WHERE status = 'concluida' AND administrador_id IS NOT NULL
  GROUP BY administrador_id
),
-- Ordens com status ativo por admin
ordens_ativas_agg AS (
  SELECT administrador_id, COUNT(*) AS qtd_ordens_ativas
  FROM public.ordens_notas_acompanhamento
  WHERE status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
    AND administrador_id IS NOT NULL
  GROUP BY administrador_id
),
-- Notas distribuídas nos últimos 7 dias por admin (para déficit semanal — 00130)
notas_7d_agg AS (
  SELECT administrador_id, COUNT(*) AS notas_recebidas_7d
  FROM public.notas_manutencao
  WHERE administrador_id IS NOT NULL
    AND distribuida_em >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
),
-- Ordens detectadas nos últimos 7 dias por admin (para déficit semanal — 00130)
ordens_7d_agg AS (
  SELECT administrador_id, COUNT(*) AS ordens_recebidas_7d
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id IS NOT NULL
    AND ordem_detectada_em >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
)
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  a.recebe_distribuicao,
  a.em_ferias,
  a.data_inicio_ferias,
  a.data_fim_ferias,
  a.motivo_bloqueio,
  COALESCE(na.qtd_nova,          0)::INTEGER AS qtd_nova,
  COALESCE(na.qtd_em_andamento,  0)::INTEGER AS qtd_em_andamento,
  COALESCE(na.qtd_encaminhada,   0)::INTEGER AS qtd_encaminhada,
  COALESCE(na.qtd_abertas,       0)::INTEGER AS qtd_abertas,
  COALESCE(nc.qtd_concluidas,    0)::INTEGER AS qtd_concluidas,
  COALESCE(oa.qtd_ordens_ativas, 0)::INTEGER AS qtd_ordens_ativas,
  -- Score: geral = notas_abertas + ordens_ativas × 0.5; especialistas = só notas_abertas
  CASE
    WHEN a.especialidade = 'geral' THEN
      ROUND(
        COALESCE(na.qtd_abertas, 0)
        + COALESCE(oa.qtd_ordens_ativas, 0) * 0.5
      )::INTEGER
    ELSE
      COALESCE(na.qtd_abertas, 0)::INTEGER
  END AS score_carga,
  -- Campos de déficit semanal (adicionados em 00130)
  a.meta_semanal,
  COALESCE(n7.notas_recebidas_7d,  0)::INTEGER AS notas_recebidas_7d,
  COALESCE(o7.ordens_recebidas_7d, 0)::INTEGER AS ordens_recebidas_7d
FROM public.administradores a
LEFT JOIN notas_abertas_agg    na  ON na.administrador_id  = a.id
LEFT JOIN notas_concluidas_agg nc  ON nc.administrador_id  = a.id
LEFT JOIN ordens_ativas_agg    oa  ON oa.administrador_id  = a.id
LEFT JOIN notas_7d_agg         n7  ON n7.administrador_id  = a.id
LEFT JOIN ordens_7d_agg        o7  ON o7.administrador_id  = a.id
WHERE a.role = 'admin';

COMMENT ON VIEW public.vw_carga_real_administradores IS
  'Carga real do admin. qtd_abertas usa os mesmos filtros de vw_notas_sem_ordem. '
  'meta_semanal, notas_recebidas_7d, ordens_recebidas_7d: usados para calcular deficit semanal no frontend. '
  'score_carga: geral = notas_abertas + (ordens_ativas x 0.5); especialistas = so notas_abertas. '
  'Reescrito em 00144 com CTEs pre-agregados para evitar join explosion (timeout 57014).';
