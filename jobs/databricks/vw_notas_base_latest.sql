-- ============================================================
-- manutencao.gold.vw_notas_base_latest
-- View gold: union de notas_qm + notas_qmel, 1 linha por NUMERO_NOTA
--
-- Lógica de deduplicação:
--   hora_nota_ts DESC  → registro mais recente ganha
--   _fonte ASC         → em empate de timestamp, qm prevalece sobre qmel
--
-- Usada por: sync_job_fast.py (GOLD_NOTES_TABLE)
-- ============================================================
CREATE OR REPLACE VIEW manutencao.gold.vw_notas_base_latest AS

-- Colunas selecionadas explicitamente para garantir UNION ALL compatível
-- entre notas_qm (85 cols) e notas_qmel (87 cols).
-- Schema confirmado via DESCRIBE manutencao.streaming.notas_qm.
WITH base AS (
  SELECT
    NUMERO_NOTA,
    TIPO_NOTA,
    TEXTO_BREVE,
    TEXTO_DESC_OBJETO,
    PRIORIDADE,
    TIPO_PRIORIDADE,
    CRIADO_POR,
    SOLICITANTE,
    DATA_CRIACAO,
    DATA_NOTA,
    HORA_NOTA,
    DATA_ATUALIZACAO,
    HORA_MODIFICACAO,
    ORDEM,
    CENTRO_MATERIAL,
    STATUS_OBJ_ADMIN,
    N_CONTA_FORNECEDOR,
    AUTOR_NOTA_QM_PM,
    DATA_CONCLUSAO,
    DATA_ENC_NOTA,
    'qm'                             AS _fonte,
    TRY_CAST(HORA_NOTA AS TIMESTAMP) AS hora_nota_ts
  FROM manutencao.streaming.notas_qm

  UNION ALL

  SELECT
    NUMERO_NOTA,
    TIPO_NOTA,
    TEXTO_BREVE,
    TEXTO_DESC_OBJETO,
    PRIORIDADE,
    TIPO_PRIORIDADE,
    CRIADO_POR,
    SOLICITANTE,
    DATA_CRIACAO,
    DATA_NOTA,
    HORA_NOTA,
    DATA_ATUALIZACAO,
    HORA_MODIFICACAO,
    ORDEM,
    CENTRO_MATERIAL,
    STATUS_OBJ_ADMIN,
    N_CONTA_FORNECEDOR,
    AUTOR_NOTA_QM_PM,
    DATA_CONCLUSAO,
    DATA_ENC_NOTA,
    'qmel'                           AS _fonte,
    TRY_CAST(HORA_NOTA AS TIMESTAMP) AS hora_nota_ts
  FROM manutencao.streaming.notas_qmel
),

deduped AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY NUMERO_NOTA
      ORDER BY hora_nota_ts DESC NULLS LAST, _fonte ASC
    ) AS _rn
  FROM base
)

SELECT * EXCEPT (_rn)
FROM deduped
WHERE _rn = 1
;
