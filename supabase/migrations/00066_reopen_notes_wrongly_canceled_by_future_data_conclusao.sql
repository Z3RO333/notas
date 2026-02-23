-- 00066_reopen_notes_wrongly_canceled_by_future_data_conclusao.sql
-- Reabre notas que foram canceladas por regra estrutural quando o SAP trazia
-- DATA_CONCLUSAO futura (previsão), sem ordem vinculada.

WITH historico_backfill AS (
  SELECT DISTINCT ON (h.nota_id)
    h.nota_id,
    LOWER(COALESCE(NULLIF(BTRIM(h.valor_anterior), ''), '')) AS status_anterior
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'cancelada'
    AND h.motivo LIKE 'Backfill estrutural: encerramento SAP sem ordem%'
  ORDER BY h.nota_id, h.created_at DESC
),
candidatos AS (
  SELECT
    n.id AS nota_id,
    CASE
      WHEN hb.status_anterior IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        THEN hb.status_anterior
      ELSE 'nova'
    END AS status_destino
  FROM public.notas_manutencao n
  LEFT JOIN historico_backfill hb
    ON hb.nota_id = n.id
  WHERE n.status = 'cancelada'
    AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL
    AND COALESCE(NULLIF(BTRIM(n.raw_data->>'DATA_ENC_NOTA'), ''), '') = ''
    AND (n.raw_data->>'DATA_CONCLUSAO') ~ '^\d{4}-\d{2}-\d{2}$'
    AND (n.raw_data->>'DATA_CONCLUSAO')::DATE > CURRENT_DATE
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
    status = CASE c.status_destino
      WHEN 'em_andamento' THEN 'em_andamento'::public.nota_status
      WHEN 'encaminhada_fornecedor' THEN 'encaminhada_fornecedor'::public.nota_status
      ELSE 'nova'::public.nota_status
    END,
    updated_at = now()
  FROM candidatos c
  WHERE n.id = c.nota_id
  RETURNING
    n.id AS nota_id,
    c.status_destino AS status_destino
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
  'cancelada',
  sc.status_destino,
  NULL,
  'Correção estrutural: DATA_CONCLUSAO futura sem ordem (reabertura para fila operacional)'
FROM status_corrigido sc;
