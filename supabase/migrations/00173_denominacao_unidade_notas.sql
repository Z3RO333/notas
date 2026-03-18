-- Migration 00173: adiciona denominacao_unidade em notas_manutencao
-- Populado via upload_sap_status_aux.py (notas_sap.xlsx)
-- Backfill via dim_centro_unidade onde centro já está preenchido

ALTER TABLE notas_manutencao ADD COLUMN IF NOT EXISTS denominacao_unidade TEXT;

UPDATE notas_manutencao nm
SET denominacao_unidade = d.unidade
FROM dim_centro_unidade d
WHERE d.centro = nm.centro
  AND nm.denominacao_unidade IS NULL;

DROP VIEW IF EXISTS public.vw_notas_metrics_30d;
DROP VIEW IF EXISTS public.vw_notas_sem_ordem;

CREATE VIEW public.vw_notas_sem_ordem AS
SELECT
  id,
  numero_nota,
  tipo_nota,
  descricao,
  descricao_objeto,
  prioridade,
  tipo_prioridade,
  criado_por_sap,
  solicitante,
  data_criacao_sap,
  data_nota,
  hora_nota,
  ordem_sap,
  centro,
  denominacao_unidade,
  status_sap,
  conta_fornecedor,
  autor_nota,
  streaming_timestamp,
  status,
  administrador_id,
  distribuida_em,
  ordem_gerada,
  fornecedor_encaminhado,
  observacoes,
  sync_id,
  raw_data,
  created_at,
  updated_at
FROM public.notas_manutencao n
WHERE status = ANY (
    ARRAY[
      'nova'::public.nota_status,
      'em_andamento'::public.nota_status,
      'encaminhada_fornecedor'::public.nota_status
    ]
  )
  AND n.exclui_cockpit = false
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.notas_status_sap_aux aux
    WHERE aux.numero_nota_norm
      = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
  );

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Painel de notas sem ordem ativa: inclui apenas notas abertas, sem ordem SAP, sem ordem ativa no cockpit e sem status SAP CANCELADA/VIROU_ORDEM.';

CREATE VIEW public.vw_notas_metrics_30d AS
WITH criadas AS (
  SELECT COUNT(*)::BIGINT AS qtd_notas_criadas_30d
  FROM public.notas_manutencao n
  WHERE COALESCE(n.data_criacao_sap, n.created_at::date)
    >= (current_date - INTERVAL '29 days')::date
),
viraram_ordem AS (
  SELECT
    COUNT(*)::BIGINT AS qtd_notas_viraram_ordem_30d,
    ROUND(AVG(o.dias_para_gerar_ordem)::NUMERIC, 2) AS tempo_medio_para_ordem_dias_30d
  FROM public.ordens_notas_acompanhamento o
  WHERE o.ordem_detectada_em >= now() - INTERVAL '30 days'
),
pendentes AS (
  SELECT COUNT(*)::BIGINT AS qtd_pendentes_sem_ordem
  FROM public.vw_notas_sem_ordem n
)
SELECT
  c.qtd_notas_criadas_30d,
  v.qtd_notas_viraram_ordem_30d,
  v.tempo_medio_para_ordem_dias_30d,
  p.qtd_pendentes_sem_ordem
FROM criadas c
CROSS JOIN viraram_ordem v
CROSS JOIN pendentes p;

ALTER VIEW public.vw_notas_sem_ordem SET (security_invoker = on);
ALTER VIEW public.vw_notas_metrics_30d SET (security_invoker = on);
