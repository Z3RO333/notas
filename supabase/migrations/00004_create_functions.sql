-- 00004_create_functions.sql
-- Funcoes do cockpit: distribuicao, atualizacao de status, reatribuicao

-- ============================================================
-- VIEW: carga por administrador
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_administradores AS
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  COUNT(n.id) FILTER (WHERE n.status = 'nova') AS qtd_nova,
  COUNT(n.id) FILTER (WHERE n.status = 'em_andamento') AS qtd_em_andamento,
  COUNT(n.id) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
  COUNT(n.id) FILTER (WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas,
  COUNT(n.id) FILTER (WHERE n.status = 'concluida') AS qtd_concluidas,
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada') AS qtd_canceladas
FROM public.administradores a
LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY a.id, a.nome, a.email, a.ativo, a.max_notas;

-- ============================================================
-- FUNCTION: distribuir_notas
-- Distribui notas novas entre admins ativos (menor carga primeiro)
-- Usa advisory lock para prevenir corrida entre syncs
-- ============================================================
CREATE OR REPLACE FUNCTION distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
DECLARE
  v_nota RECORD;
  v_admin RECORD;
BEGIN
  -- Advisory lock: previne distribuicao concorrente
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  -- Loop pelas notas nao atribuidas (mais antiga primeiro)
  FOR v_nota IN
    SELECT id
    FROM public.notas_manutencao
    WHERE status = 'nova'
      AND administrador_id IS NULL
    ORDER BY data_criacao_sap ASC NULLS LAST, created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Busca admin com menor carga que ainda tem capacidade
    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.ativo = true
      AND a.role = 'admin'
    GROUP BY a.id, a.max_notas, a.nome
    HAVING COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < a.max_notas
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    -- Se nenhum admin disponivel, para a distribuicao
    IF v_admin IS NULL THEN
      EXIT;
    END IF;

    -- Atribui a nota
    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    -- Log da atribuicao
    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    -- Auditoria
    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuicao automatica - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    -- Retorna a atribuicao
    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: atualizar_status_nota
-- Transicao de status com validacao e auditoria
-- ============================================================
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
    OR (v_old_status = 'em_andamento' AND p_novo_status IN ('encaminhada_fornecedor', 'cancelada'))
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

-- ============================================================
-- FUNCTION: reatribuir_nota
-- Gestor move nota de um admin para outro
-- ============================================================
CREATE OR REPLACE FUNCTION reatribuir_nota(
  p_nota_id UUID,
  p_novo_admin_id UUID,
  p_gestor_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS public.notas_manutencao AS $$
DECLARE
  v_nota public.notas_manutencao;
  v_old_admin_id UUID;
BEGIN
  SELECT * INTO v_nota
  FROM public.notas_manutencao
  WHERE id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota % nao encontrada', p_nota_id;
  END IF;

  v_old_admin_id := v_nota.administrador_id;

  UPDATE public.notas_manutencao
  SET
    administrador_id = p_novo_admin_id,
    distribuida_em = now(),
    updated_at = now()
  WHERE id = p_nota_id
  RETURNING * INTO v_nota;

  -- Auditoria
  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
  VALUES (
    p_nota_id,
    'administrador_id',
    COALESCE(v_old_admin_id::TEXT, 'NULL'),
    p_novo_admin_id::TEXT,
    p_gestor_id,
    COALESCE(p_motivo, 'Reatribuicao manual pelo gestor')
  );

  RETURN v_nota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Helpers para RLS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_admin_id()
RETURNS UUID AS $$
  SELECT id FROM public.administradores WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM public.administradores WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;
