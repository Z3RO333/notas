-- 00270_notes_panel_filter_indexes.sql
--
-- Performance do Painel de Notas.
-- Mantem vw_notas_sem_ordem como fonte canonica, mas melhora os filtros reais
-- usados pela tela: status, responsavel, unidade/centro e ordenacao por data.

CREATE INDEX IF NOT EXISTS idx_notas_panel_admin_status_centro_data
  ON public.notas_manutencao (
    administrador_id,
    status,
    centro,
    data_criacao_sap,
    id
  )
  WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND (ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000'));

CREATE INDEX IF NOT EXISTS idx_notas_panel_status_centro_data
  ON public.notas_manutencao (
    status,
    centro,
    data_criacao_sap,
    id
  )
  WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND (ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000'));

CREATE INDEX IF NOT EXISTS idx_notas_panel_unassigned_status_data
  ON public.notas_manutencao (
    status,
    data_criacao_sap,
    id
  )
  WHERE administrador_id IS NULL
    AND status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND (ordem_sap IS NULL OR TRIM(ordem_sap) IN ('', '0', '00000000'));

CREATE INDEX IF NOT EXISTS idx_notas_operacao_estado_nota_id
  ON public.notas_operacao_estado (nota_id);
