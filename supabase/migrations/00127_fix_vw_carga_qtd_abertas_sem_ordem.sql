-- 00127_fix_vw_carga_qtd_abertas_sem_ordem.sql
--
-- Problema:
--   vw_carga_real_administradores contava qtd_abertas como TODAS as notas com
--   status aberto (nova/em_andamento/encaminhada_fornecedor), incluindo notas que
--   o SAP já marcou como VIROU_ORDEM/CANCELADA e notas com ordens ativas no cockpit.
--   O painel (vw_notas_sem_ordem) exclui essas notas — por isso o número no card
--   ("Notas abertas: 66") divergia da soma dos buckets de aging (27) que vêm do painel.
--
-- Solução:
--   Adicionar as mesmas condições de vw_notas_sem_ordem na contagem de qtd_abertas:
--     1. ordem_sap deve ser nulo/vazio/zero
--     2. Sem ordem ativa no cockpit (status_ordem NOT IN ('concluida','cancelada'))
--     3. Sem status CANCELADA ou VIROU_ORDEM em notas_status_sap_aux
--
--   A estratégia usa dois LEFT JOINs adicionais (sem subquery no FILTER, que não é suportado):
--     - o_active: notas que têm ordem ativa no cockpit (DISTINCT nota_id)
--     - sap_aux:  última entrada de notas_status_sap_aux por numero_nota_norm (via view existente)

CREATE OR REPLACE VIEW public.vw_carga_real_administradores AS
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
  -- Contagens filtradas igual a vw_notas_sem_ordem (sem ordens ativas, sem SAP VIROU_ORDEM/CANCELADA)
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
  -- Ordens ativas (não muda)
  COUNT(DISTINCT o.id) FILTER (
    WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
  )::INTEGER AS qtd_ordens_ativas,
  -- Score: peso de ordens apenas para geral
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
  END AS score_carga
FROM public.administradores a
LEFT JOIN public.notas_manutencao n
  ON n.administrador_id = a.id
-- Ordens de acompanhamento (para qtd_ordens_ativas e score)
LEFT JOIN public.ordens_notas_acompanhamento o
  ON o.nota_id = n.id
-- Notas com ordem ATIVA no cockpit (para excluir de qtd_abertas)
LEFT JOIN (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE status_ordem NOT IN ('concluida', 'cancelada')
) o_active ON o_active.nota_id = n.id
-- Status SAP aux mais recente (para excluir VIROU_ORDEM / CANCELADA)
LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
  ON sap_aux.numero_nota_norm
     = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
WHERE a.role = 'admin'
GROUP BY
  a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url,
  a.especialidade, a.recebe_distribuicao, a.em_ferias,
  a.data_inicio_ferias, a.data_fim_ferias, a.motivo_bloqueio;

COMMENT ON VIEW public.vw_carga_real_administradores IS
  'Carga real do admin. qtd_abertas usa os mesmos filtros de vw_notas_sem_ordem: '
  'exclui notas com ordem_sap preenchida, com ordem ativa no cockpit, '
  'ou com status CANCELADA/VIROU_ORDEM no SAP aux. '
  'Isso garante consistência com os buckets de aging exibidos no painel. '
  'score_carga: geral = notas_abertas + (ordens_ativas × 0.5); especialistas = só notas_abertas. '
  'Corrigido em 00127.';
