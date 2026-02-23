-- 00065_backfill_canceladas_sem_ordem_por_encerramento_sap.sql
-- Marca como cancelada notas abertas sem ordem quando o payload SAP já indica
-- encerramento/conclusão (DATA_CONCLUSAO ou DATA_ENC_NOTA), evitando reentrada
-- no painel de distribuição.

WITH candidatos AS (
  SELECT
    n.id AS nota_id,
    n.status::TEXT AS status_anterior
  FROM public.notas_manutencao n
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL
    AND (
      COALESCE(NULLIF(BTRIM(n.raw_data->>'DATA_CONCLUSAO'), ''), '') <> ''
      OR COALESCE(NULLIF(BTRIM(n.raw_data->>'DATA_ENC_NOTA'), ''), '') <> ''
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.ordens_notas_acompanhamento o
      WHERE o.nota_id = n.id
         OR (
           o.nota_id IS NULL
           AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
           AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
               = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
         )
    )
),
status_corrigido AS (
  UPDATE public.notas_manutencao n
  SET
    status = 'cancelada',
    updated_at = now()
  FROM candidatos c
  WHERE n.id = c.nota_id
  RETURNING n.id AS nota_id, c.status_anterior
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
  sc.nota_id,
  'status',
  sc.status_anterior,
  'cancelada',
  NULL,
  'Backfill estrutural: encerramento SAP sem ordem (DATA_CONCLUSAO/DATA_ENC_NOTA)'
FROM status_corrigido sc;
