-- 00061_fix_notes_panel_scope_and_legacy_leak.sql
-- Corrige vazamento de notas no Painel de Notas:
-- 1) backfill de inconsistências (nota aberta com ordem vinculada)
-- 2) endurecimento da view canônica vw_notas_sem_ordem

-- ============================================================
-- 1) BACKFILL LEGADO
-- ============================================================
-- Regra:
-- - Se existe ordem vinculada por nota_id e ordem_gerada está vazia, preencher.
-- - Se a nota está aberta e já possui ordem vinculada, concluir a nota.
-- - Registrar histórico de alteração de status.

WITH ordens_por_nota AS (
  SELECT
    o.nota_id,
    o.ordem_codigo,
    ROW_NUMBER() OVER (
      PARTITION BY o.nota_id
      ORDER BY
        COALESCE(o.status_atualizado_em, o.ordem_detectada_em, o.updated_at, o.created_at) DESC,
        o.id DESC
    ) AS rn
  FROM public.ordens_notas_acompanhamento o
  WHERE o.nota_id IS NOT NULL
),
ultima_ordem AS (
  SELECT nota_id, ordem_codigo
  FROM ordens_por_nota
  WHERE rn = 1
),
ordem_preenchida AS (
  UPDATE public.notas_manutencao n
  SET
    ordem_gerada = u.ordem_codigo,
    updated_at = now()
  FROM ultima_ordem u
  WHERE n.id = u.nota_id
    AND COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
  RETURNING n.id
),
status_para_corrigir AS (
  SELECT
    n.id AS nota_id,
    n.status::TEXT AS status_anterior,
    u.ordem_codigo
  FROM public.notas_manutencao n
  JOIN ultima_ordem u
    ON u.nota_id = n.id
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
),
status_corrigido AS (
  UPDATE public.notas_manutencao n
  SET
    status = 'concluida',
    ordem_gerada = COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), s.ordem_codigo),
    updated_at = now()
  FROM status_para_corrigir s
  WHERE n.id = s.nota_id
  RETURNING n.id
)
INSERT INTO public.notas_historico (
  nota_id,
  campo_alterado,
  valor_anterior,
  valor_novo,
  alterado_por,
  motivo
)
SELECT
  s.nota_id,
  'status',
  s.status_anterior,
  'concluida',
  NULL,
  'Correção de legado: nota aberta com ordem vinculada no acompanhamento'
FROM status_para_corrigir s
JOIN status_corrigido c
  ON c.id = s.nota_id;

-- ============================================================
-- 2) VIEW CANÔNICA ENDURECIDA
-- ============================================================
-- Painel de Notas deve exibir somente notas abertas e sem ordem operacional real.
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT n.*
FROM public.notas_manutencao n
WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
  );

