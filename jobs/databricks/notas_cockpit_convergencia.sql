-- ============================================================
-- notas_cockpit_convergencia
-- Dataset mensal de convergência Nota x Ordem
-- Fonte exclusiva: manutencao.streaming.notas_qm
-- Carga a partir de: configurável via widget sync_start_date
--   Padrão: 2024-01-01 (cobre histórico operacional completo)
--   Para ajustar: defina o widget sync_start_date no job Databricks
-- ============================================================
-- Widget Databricks (defina no cluster/job):
--   sync_start_date = 2024-01-01
CREATE OR REPLACE VIEW manutencao.gold.notas_cockpit_convergencia AS

WITH

-- --------------------------------------------------------
-- 1. staging
--    Normaliza HORA_NOTA para TIMESTAMP e aplica o filtro
--    de recorte diretamente na coluna de partição (sem
--    funções sobre ela) para preservar partition pruning.
--    Data configurável via widget sync_start_date.
-- --------------------------------------------------------
staging AS (
  SELECT
    NUMERO_NOTA,
    ORDEM,
    DATA_CONCLUSAO,
    CAST(HORA_NOTA AS TIMESTAMP) AS hora_nota_ts
  FROM manutencao.streaming.notas_qm
  WHERE HORA_NOTA >= TIMESTAMP(getArgument('sync_start_date'))
),

-- --------------------------------------------------------
-- 2. dedup
--    1 registro por NUMERO_NOTA: mais recente por
--    hora_nota_ts; NUMERO_NOTA DESC como desempate
--    determinístico em caso de empate de timestamp.
-- --------------------------------------------------------
dedup AS (
  SELECT
    NUMERO_NOTA,
    ORDEM,
    DATA_CONCLUSAO,
    hora_nota_ts,
    ROW_NUMBER() OVER (
      PARTITION BY NUMERO_NOTA
      ORDER BY hora_nota_ts DESC, NUMERO_NOTA DESC
    ) AS rn
  FROM staging
),

-- --------------------------------------------------------
-- 3. base
--    tem_ordem: FALSE se ORDEM é null, vazia ou zero.
--    Se ORDEM for numérica, substituir CAST por:
--      WHEN ORDEM IS NULL OR ORDEM = 0 THEN FALSE
-- --------------------------------------------------------
base AS (
  SELECT
    NUMERO_NOTA,
    ORDEM,
    DATA_CONCLUSAO,
    hora_nota_ts,
    YEAR(hora_nota_ts)  AS ano,
    MONTH(hora_nota_ts) AS mes,
    CASE
      WHEN ORDEM IS NULL                        THEN FALSE
      WHEN CAST(ORDEM AS STRING) IN ('', '0')   THEN FALSE
      ELSE TRUE
    END AS tem_ordem
  FROM dedup
  WHERE rn = 1
),

-- --------------------------------------------------------
-- 4. com_status
--    status_operacional derivado — não sai no dataset final.
--    Regra 1 (prioritária): DATA_CONCLUSAO preenchida
--                           + sem ordem → cancelada
--    Regra 2: DATA_CONCLUSAO nula + ordem válida → em_andamento
-- --------------------------------------------------------
com_status AS (
  SELECT
    b.*,
    CASE
      WHEN b.DATA_CONCLUSAO IS NOT NULL AND NOT b.tem_ordem
        THEN 'cancelada'       -- Regra 1 (prioritária)
      WHEN b.DATA_CONCLUSAO IS NULL AND b.tem_ordem
        THEN 'em_andamento'    -- Regra 2
      ELSE NULL
    END AS status_operacional_base
  FROM base b
),

-- --------------------------------------------------------
-- 5. com_pmpl
--    Enriquece com manutencao.gold.pmpl_pmos quando
--    a nota tem ordem válida.
--    Regra 1 (DATA_CONCLUSAO + sem ordem) sempre prevalece.
--    Se pp.ordem tiver nome diferente, ajustar o ON.
-- --------------------------------------------------------
com_pmpl AS (
  SELECT
    cs.NUMERO_NOTA,
    cs.ano,
    cs.mes,
    cs.tem_ordem,
    CASE
      -- Regra 1 prevalece sobre qualquer mapeamento de pmpl_pmos
      WHEN cs.DATA_CONCLUSAO IS NOT NULL AND NOT cs.tem_ordem
        THEN 'cancelada'
      ELSE
        COALESCE(
          CASE UPPER(TRIM(pp.STATUS))
            WHEN 'ABERTO'                    THEN 'em_andamento'
            WHEN 'EM_PROCESSAMENTO'          THEN 'em_andamento'
            WHEN 'EM_EXECUCAO'               THEN 'em_andamento'
            WHEN 'AVALIACAO_DA_EXECUCAO'     THEN 'em_andamento'
            WHEN 'AVALIACAO_DE_EXECUCAO'     THEN 'em_andamento'
            WHEN 'EQUIPAMENTO_EM_CONSERTO'   THEN 'em_andamento'
            WHEN 'EXECUCAO_NAO_REALIZADA'    THEN 'em_andamento'
            WHEN 'ENVIAR_EMAIL_PFORNECEDOR'  THEN 'em_andamento'
            WHEN 'CONCLUIDO'                 THEN 'concluida'
            WHEN 'AGUARDANDO_FATURAMENTO_NF' THEN 'concluida'
            WHEN 'EXECUCAO_SATISFATORIO'     THEN 'concluida'
            WHEN 'EXECUCAO_SATISFATORIA'     THEN 'concluida'
            WHEN 'CANCELADO'                 THEN 'cancelada'
            ELSE NULL
          END,
          cs.status_operacional_base
        )
    END AS status_operacional
  FROM com_status cs
  LEFT JOIN manutencao.gold.pmpl_pmos pp
    ON  cs.tem_ordem = TRUE
    AND CAST(cs.ORDEM AS STRING) = CAST(pp.ordem AS STRING)
    -- Se ambos já forem STRING ou ambos NUMERIC, remover os CASTs
)

-- --------------------------------------------------------
-- 6. Agregação mensal final
-- --------------------------------------------------------
SELECT
  ano,
  mes,
  COUNT(*)                                          AS total_notas,
  COUNT(*) FILTER (WHERE NOT tem_ordem)             AS notas_sem_ordem,
  COUNT(*) FILTER (WHERE     tem_ordem)             AS notas_com_ordem,
  ROUND(
    COUNT(*) FILTER (WHERE tem_ordem) * 100.0
    / NULLIF(COUNT(*), 0),
    2
  )                                                 AS percentual_conversao
FROM com_pmpl
GROUP BY ano, mes
ORDER BY ano, mes
;
