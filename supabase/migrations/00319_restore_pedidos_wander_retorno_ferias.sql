-- 00319_restore_pedidos_wander_retorno_ferias.sql
--
-- Restaura ao Wanderlucio a responsabilidade operacional dos quatro contratos
-- preventivos da carteira dele e devolve a carteira corretiva da Rio Negro,
-- transferida temporariamente ao Mayky durante as ferias.
--
-- O backfill e deliberadamente limitado aos documentos/fornecedor confirmados
-- em producao. O sync de pedidos preserva administrador_id de documentos ja
-- existentes, portanto a reatribuicao nao sera sobrescrita pelo proximo sync.

DO $$
DECLARE
  v_wander_id UUID;
  v_paula_id UUID;
  v_mayky_id UUID;
  v_gestor_id UUID;
  v_rio_owner_id UUID;
  v_contratos_encontrados INTEGER;
  v_contratos_divergentes INTEGER;
  v_contratos_atualizados INTEGER := 0;
  v_rio_atualizada BOOLEAN := false;
BEGIN
  SELECT id INTO v_wander_id
  FROM public.administradores
  WHERE email = 'wanderluciomendes@bemol.com.br';

  SELECT id INTO v_paula_id
  FROM public.administradores
  WHERE email = 'paulamatos@bemol.com.br';

  SELECT id INTO v_mayky_id
  FROM public.administradores
  WHERE email = 'maykycastro@bemol.com.br';

  SELECT id INTO v_gestor_id
  FROM public.administradores
  WHERE email = 'gustavoandrade@bemol.com.br'
    AND role = 'gestor';

  IF v_wander_id IS NULL OR v_paula_id IS NULL OR v_mayky_id IS NULL OR v_gestor_id IS NULL THEN
    RAISE EXCEPTION
      'Migration 00319 abortada: Wanderlucio, Paula, Mayky ou gestor Gustavo nao encontrado';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_contratos_encontrados
  FROM public.pedidos_compra p
  WHERE p.documento_compras IN (
    '4508548699',
    '4508548366',
    '4508564720',
    '4508591118'
  )
    AND p.is_contrato_anual = true
    AND public.normalize_supplier_code(p.fornecedor) IN ('8059', '10364', '16744', '7949');

  IF v_contratos_encontrados <> 4 THEN
    RAISE EXCEPTION
      'Migration 00319 abortada: esperados 4 contratos preventivos validos, encontrados %',
      v_contratos_encontrados;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_contratos_divergentes
  FROM public.pedidos_compra p
  WHERE p.documento_compras IN (
    '4508548699',
    '4508548366',
    '4508564720',
    '4508591118'
  )
    AND p.administrador_id NOT IN (v_paula_id, v_wander_id);

  IF v_contratos_divergentes > 0 THEN
    RAISE EXCEPTION
      'Migration 00319 abortada: % contrato(s) possuem responsavel diferente de Paula/Wander',
      v_contratos_divergentes;
  END IF;

  UPDATE public.pedidos_compra
  SET administrador_id = v_wander_id,
      updated_at = now()
  WHERE documento_compras IN (
    '4508548699',
    '4508548366',
    '4508564720',
    '4508591118'
  )
    AND administrador_id = v_paula_id;

  GET DIAGNOSTICS v_contratos_atualizados = ROW_COUNT;

  SELECT c.administrador_id
  INTO v_rio_owner_id
  FROM public.pedidos_compra_carteira_fornecedor c
  WHERE c.fornecedor_codigo = '16883'
    AND c.tipo_carteira = 'corretiva'
    AND c.ativo = true
  FOR UPDATE;

  IF v_rio_owner_id IS NULL THEN
    RAISE EXCEPTION
      'Migration 00319 abortada: carteira corretiva ativa da Rio Negro (16883) nao encontrada';
  END IF;

  IF v_rio_owner_id = v_mayky_id THEN
    UPDATE public.pedidos_compra_carteira_fornecedor
    SET administrador_id = v_wander_id,
        updated_at = now(),
        updated_by = v_gestor_id
    WHERE fornecedor_codigo = '16883';

    INSERT INTO public.pedidos_compra_carteira_fornecedor_audit (
      fornecedor_codigo,
      fornecedor_nome,
      admin_anterior_id,
      admin_anterior_nome,
      admin_novo_id,
      admin_novo_nome,
      motivo,
      alterado_por
    ) VALUES (
      '16883',
      'RIO NEGRO',
      v_mayky_id,
      'Mayky Castro',
      v_wander_id,
      'Wanderlucio Mendes',
      'Retorno de ferias do Wanderlucio; devolucao da carteira Rio Negro',
      v_gestor_id
    );

    v_rio_atualizada := true;
  ELSIF v_rio_owner_id <> v_wander_id THEN
    RAISE EXCEPTION
      'Migration 00319 abortada: Rio Negro pertence a responsavel inesperado %',
      v_rio_owner_id;
  END IF;

  IF v_contratos_atualizados > 0 OR v_rio_atualizada THEN
    INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
    VALUES (
      v_gestor_id,
      'restaurar_pedidos_wander_retorno_ferias',
      v_wander_id,
      jsonb_build_object(
        'motivo', 'Retorno de ferias do Wanderlucio',
        'contratos_preventivos_atualizados', v_contratos_atualizados,
        'documentos_preventivos', jsonb_build_array(
          '4508548699',
          '4508548366',
          '4508564720',
          '4508591118'
        ),
        'fornecedor_corretiva', '16883',
        'rio_negro_atualizada', v_rio_atualizada
      )
    );
  END IF;

  RAISE NOTICE
    'Migration 00319: % contratos preventivos atualizados; Rio Negro atualizada=%',
    v_contratos_atualizados,
    v_rio_atualizada;
END $$;
