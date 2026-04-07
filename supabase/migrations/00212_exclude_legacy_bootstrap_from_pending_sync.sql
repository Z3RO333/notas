-- 00212_exclude_legacy_bootstrap_from_pending_sync.sql
--
-- Problema:
-- A secao "Aguardando confirmacao do sync" passou a listar ordens legadas
-- bootstrapadas no inicio do projeto como se fossem pendencias operacionais
-- atuais. Nesses casos, ordem_detectada_em reflete o bootstrap no Supabase,
-- nao a antiguidade real da nota.
--
-- Regra:
-- - pending sync deve mostrar somente bootstrap operacional recente
-- - legados cuja data_nota esteja muito anterior a ordem_detectada_em devem
--   ficar fora dessa UX provisoria
--
-- Fix:
-- - refina vw_ordens_notas_sync_pendente para exigir coerencia temporal entre
--   data_nota e ordem_detectada_em (janela maxima de 30 dias)

CREATE OR REPLACE VIEW public.vw_ordens_notas_sync_pendente AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
bootstrap AS (
  SELECT DISTINCT
    h.ordem_id
  FROM public.ordens_notas_historico h
  WHERE h.origem = 'detectada_na_nota'
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
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    public.normalizar_status_ordem(o.status_ordem_raw) AS status_ordem,
    o.status_ordem_raw,
    COALESCE(o.ordem_detectada_em, o.created_at) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem,
    COALESCE(
      n.data_nota,
      CASE
        WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_NOTA'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN (n.raw_data ->> 'DATA_NOTA')::DATE
        ELSE NULL
      END,
      CASE
        WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_CRIACAO'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN (n.raw_data ->> 'DATA_CRIACAO')::DATE
        ELSE NULL
      END
    ) AS nota_data_referencia
  FROM public.ordens_notas_acompanhamento o
  JOIN bootstrap b
    ON b.ordem_id = o.id
  JOIN public.notas_manutencao n
    ON n.id = o.nota_id
  LEFT JOIN public.administradores origem
    ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual
    ON atual.id = CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END
  LEFT JOIN public.dim_centro_unidade d
    ON d.centro = o.centro
  LEFT JOIN historico h
    ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NULL
    AND o.nota_id IS NOT NULL
    AND (
      COALESCE(
        n.data_nota,
        CASE
          WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_NOTA'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN (n.raw_data ->> 'DATA_NOTA')::DATE
          ELSE NULL
        END,
        CASE
          WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_CRIACAO'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN (n.raw_data ->> 'DATA_CRIACAO')::DATE
          ELSE NULL
        END
      ) IS NULL
      OR COALESCE(
        n.data_nota,
        CASE
          WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_NOTA'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN (n.raw_data ->> 'DATA_NOTA')::DATE
          ELSE NULL
        END,
        CASE
          WHEN NULLIF(BTRIM(n.raw_data ->> 'DATA_CRIACAO'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN (n.raw_data ->> 'DATA_CRIACAO')::DATE
          ELSE NULL
        END
      ) >= (COALESCE(o.ordem_detectada_em, o.created_at)::date - 30)
    )
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

COMMENT ON VIEW public.vw_ordens_notas_sync_pendente IS
  'Ordens bootstrap detectadas na nota e ainda sem confirmacao oficial de data_entrada. Exclui legados bootstrapados cuja data_nota esteja mais de 30 dias antes da deteccao, preservando apenas a UX operacional recente.';
