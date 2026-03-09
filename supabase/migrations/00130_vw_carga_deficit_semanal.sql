-- 00130_vw_carga_deficit_semanal.sql
--
-- Adiciona à vw_carga_real_administradores os campos necessários para
-- exibir o déficit semanal no painel:
--   meta_semanal        → meta de carga semanal do admin
--   notas_recebidas_7d  → notas distribuídas nos últimos 7 dias
--   ordens_recebidas_7d → ordens detectadas nos últimos 7 dias
--
-- O frontend calcula:
--   carga_7d  = notas_recebidas_7d × 1.0 + ordens_recebidas_7d × 0.5
--   deficit   = meta_semanal - carga_7d

CREATE OR REPLACE VIEW public.vw_carga_real_administradores AS
-- meta_semanal adicionada ao final para não reordenar colunas existentes
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
  -- Contagens filtradas igual a vw_notas_sem_ordem
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'nova'
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND o_active.nota_id IS NULL
      AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
  )::INTEGER AS qtd_nova,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'em_andamento'
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND o_active.nota_id IS NULL
      AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
  )::INTEGER AS qtd_em_andamento,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'encaminhada_fornecedor'
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND o_active.nota_id IS NULL
      AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
  )::INTEGER AS qtd_encaminhada,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND o_active.nota_id IS NULL
      AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
  )::INTEGER AS qtd_abertas,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'concluida'
  )::INTEGER AS qtd_concluidas,
  -- Ordens ativas
  COUNT(DISTINCT o.id) FILTER (
    WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
  )::INTEGER AS qtd_ordens_ativas,
  -- Score legado (mantido para compatibilidade)
  CASE
    WHEN a.especialidade = 'geral' THEN
      ROUND(
        COUNT(DISTINCT n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
            AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
            AND o_active.nota_id IS NULL
            AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
        )
        + COUNT(DISTINCT o.id) FILTER (
          WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
        ) * 0.5
      )::INTEGER
    ELSE
      COUNT(DISTINCT n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
          AND o_active.nota_id IS NULL
          AND (sap_aux.status_canonico IS NULL OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM'))
      )::INTEGER
  END AS score_carga,
  -- Campos novos (00130): déficit semanal
  a.meta_semanal,
  COUNT(DISTINCT n_7d.id)::INTEGER AS notas_recebidas_7d,
  COUNT(DISTINCT o_7d.id)::INTEGER AS ordens_recebidas_7d
FROM public.administradores a
LEFT JOIN public.notas_manutencao n
  ON n.administrador_id = a.id
-- Ordens de acompanhamento (qtd_ordens_ativas e score)
LEFT JOIN public.ordens_notas_acompanhamento o
  ON o.nota_id = n.id
-- Notas com ordem ATIVA no cockpit (excluir de qtd_abertas)
LEFT JOIN (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE status_ordem NOT IN ('concluida', 'cancelada')
) o_active ON o_active.nota_id = n.id
-- Status SAP aux mais recente
LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
  ON sap_aux.numero_nota_norm
     = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
-- Notas recebidas nos últimos 7 dias (para déficit semanal)
LEFT JOIN public.notas_manutencao n_7d
  ON n_7d.administrador_id = a.id
 AND n_7d.distribuida_em >= NOW() - INTERVAL '7 days'
-- Ordens detectadas nos últimos 7 dias (para déficit semanal)
LEFT JOIN public.ordens_notas_acompanhamento o_7d
  ON o_7d.administrador_id = a.id
 AND o_7d.ordem_detectada_em >= NOW() - INTERVAL '7 days'
WHERE a.role = 'admin'
GROUP BY
  a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url,
  a.especialidade, a.recebe_distribuicao, a.em_ferias,
  a.data_inicio_ferias, a.data_fim_ferias, a.motivo_bloqueio, a.meta_semanal;

COMMENT ON VIEW public.vw_carga_real_administradores IS
  'Carga real do admin. '
  'qtd_abertas: mesmos filtros de vw_notas_sem_ordem (sem ordem_sap, sem ordem ativa cockpit, sem SAP CANCELADA/VIROU_ORDEM). '
  'meta_semanal, notas_recebidas_7d, ordens_recebidas_7d: usados para calcular déficit semanal no frontend. '
  'score_carga mantido para compatibilidade. '
  'Atualizado em 00130.';
