-- 20260820150000_remove_mayky_e_edeson_desligados.sql
--
-- Mayky Castro (admin) e Edeson Monteiro Sousa (operacional, codigo 22016) foram
-- desligados da empresa. Exclusão física solicitada explicitamente (ciente da perda
-- de auditoria em distribuicao_log e nota_acompanhamentos, avaliada antes de aplicar).
--
-- Ordem de operações necessária para não violar FK (a maioria das colunas que apontam
-- pra administradores é NO ACTION/NOT NULL, não SET NULL automático):
--   1. Apaga linhas de auditoria/log que não podem ser nulificadas (NOT NULL)
--   2. Nulifica colunas nullable que referenciam o Mayky, preservando os registros pai
--   3. Deleta o admin (cascateia sozinho: administrador_emails, nota_acompanhamentos,
--      sap_user_admin_map, e seta NULL em ordens_notas_acompanhamento.criado_por etc.)
--   4. Deleta o operacional (sem FKs pendentes — verificado antes)

DO $$
DECLARE
  v_mayky_id UUID;
BEGIN
  SELECT id INTO v_mayky_id FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';

  IF v_mayky_id IS NULL THEN
    RAISE NOTICE 'Mayky já não existe em administradores — pulando.';
    RETURN;
  END IF;

  -- 1) Linhas NOT NULL que não podem ser nulificadas — apaga
  DELETE FROM public.distribuicao_log WHERE administrador_id = v_mayky_id;
  DELETE FROM public.escala_distribuicao_sabado_participantes WHERE administrador_id = v_mayky_id;
  DELETE FROM public.pedidos_compra_carteira_fornecedor_audit
    WHERE admin_anterior_id = v_mayky_id OR admin_novo_id = v_mayky_id OR alterado_por = v_mayky_id;
  DELETE FROM public.pmpl_carteira_audit
    WHERE admin_anterior_id = v_mayky_id OR admin_novo_id = v_mayky_id OR alterado_por = v_mayky_id;

  -- 2) Colunas nullable — desanexa preservando o registro pai
  UPDATE public.ordens_notas_acompanhamento SET administrador_id = NULL WHERE administrador_id = v_mayky_id;
  UPDATE public.pedidos_compra SET administrador_id = NULL WHERE administrador_id = v_mayky_id;
  UPDATE public.pedidos_compra SET criador_admin_id = NULL WHERE criador_admin_id = v_mayky_id;
  UPDATE public.admin_audit_log SET alvo_id = NULL WHERE alvo_id = v_mayky_id;
  UPDATE public.copy_intent_log SET ator_admin_id = NULL WHERE ator_admin_id = v_mayky_id;
  UPDATE public.notas_operacao_estado SET em_geracao_por_admin_id = NULL WHERE em_geracao_por_admin_id = v_mayky_id;

  -- 3) Apaga o admin (cascateia nota_acompanhamentos, administrador_emails, sap_user_admin_map)
  DELETE FROM public.administradores WHERE id = v_mayky_id;

  RAISE NOTICE 'Mayky removido de administradores e dependências.';
END $$;

-- 4) Edeson (dim_operacionais) — sem FKs pendentes (verificado: nenhuma linha em
-- operacional_unidades, operacional_saidas, operacional_ordem_redistribuicoes ou
-- administradores.operacional_codigo referencia '22016')
DELETE FROM public.dim_operacionais WHERE codigo = '22016';
