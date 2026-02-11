-- =============================================
-- MIGRATION 00012: Permitir concluir nota direto de em_andamento
-- Antes: em_andamento -> encaminhada_fornecedor -> concluida
-- Depois: em_andamento -> concluida (direto) tambem e valido
-- =============================================

CREATE OR REPLACE FUNCTION atualizar_status_nota(
  p_nota_id UUID,
  p_novo_status nota_status,
  p_admin_id UUID,
  p_ordem_gerada TEXT DEFAULT NULL,
  p_fornecedor_encaminhado TEXT DEFAULT NULL,
  p_observacoes TEXT DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS public.notas_manutencao AS $$
DECLARE
  v_nota public.notas_manutencao;
  v_old_status nota_status;
BEGIN
  SELECT * INTO v_nota
  FROM public.notas_manutencao
  WHERE id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota % nao encontrada', p_nota_id;
  END IF;

  v_old_status := v_nota.status;

  -- Valida transicao de status
  IF NOT (
    (v_old_status = 'nova' AND p_novo_status IN ('em_andamento', 'cancelada'))
    OR (v_old_status = 'em_andamento' AND p_novo_status IN ('encaminhada_fornecedor', 'concluida', 'cancelada'))
    OR (v_old_status = 'encaminhada_fornecedor' AND p_novo_status IN ('concluida', 'em_andamento', 'cancelada'))
  ) THEN
    RAISE EXCEPTION 'Transicao de status invalida: % -> %', v_old_status, p_novo_status;
  END IF;

  -- Atualiza a nota
  UPDATE public.notas_manutencao
  SET
    status = p_novo_status,
    ordem_gerada = COALESCE(p_ordem_gerada, ordem_gerada),
    fornecedor_encaminhado = COALESCE(p_fornecedor_encaminhado, fornecedor_encaminhado),
    observacoes = COALESCE(p_observacoes, observacoes),
    updated_at = now()
  WHERE id = p_nota_id
  RETURNING * INTO v_nota;

  -- Auditoria
  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
  VALUES (p_nota_id, 'status', v_old_status::TEXT, p_novo_status::TEXT, p_admin_id, p_motivo);

  RETURN v_nota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
