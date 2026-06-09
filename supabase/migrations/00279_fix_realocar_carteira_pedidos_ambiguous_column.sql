-- 00279_fix_realocar_carteira_pedidos_ambiguous_column.sql
-- Corrige ambiguidade de coluna na RPC realocar_carteira_fornecedor_pedidos.
--
-- O problema: na cláusula WHERE do UPDATE, o nome "fornecedor_codigo" era ambíguo
-- entre a coluna da tabela e o parâmetro de saída implícito do RETURNS TABLE.
-- Fix: qualificar com alias da tabela (pcc.fornecedor_codigo = v_codigo).

DROP FUNCTION IF EXISTS public.realocar_carteira_fornecedor_pedidos(TEXT, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.realocar_carteira_fornecedor_pedidos(
  p_fornecedor_codigo TEXT,
  p_novo_admin_id     UUID,
  p_gestor_id         UUID,
  p_motivo            TEXT DEFAULT NULL
)
RETURNS TABLE (
  fornecedor_codigo   TEXT,
  fornecedor_nome     TEXT,
  admin_anterior_id   UUID,
  admin_anterior_nome TEXT,
  admin_novo_id       UUID,
  admin_novo_nome     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo          TEXT;
  v_gestor_role     user_role;
  v_novo_role       user_role;
  v_novo_especialidade TEXT;
  v_novo_ativo      BOOLEAN;
  v_novo_nome       TEXT;
  v_anterior_id     UUID;
  v_anterior_nome   TEXT;
  v_fornecedor_nome TEXT;
BEGIN
  v_codigo := public.normalize_supplier_code(p_fornecedor_codigo);

  IF v_codigo IS NULL THEN
    RAISE EXCEPTION 'Código de fornecedor inválido: %', p_fornecedor_codigo;
  END IF;

  SELECT role INTO v_gestor_role
  FROM public.administradores
  WHERE id = p_gestor_id;

  IF v_gestor_role IS NULL THEN
    RAISE EXCEPTION 'Gestor não encontrado: %', p_gestor_id;
  END IF;

  IF v_gestor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Apenas gestores podem realocar a carteira de fornecedores de Pedidos de Compra.';
  END IF;

  SELECT role, especialidade, ativo, nome
  INTO v_novo_role, v_novo_especialidade, v_novo_ativo, v_novo_nome
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  IF v_novo_role IS NULL THEN
    RAISE EXCEPTION 'Administrador destino não encontrado: %', p_novo_admin_id;
  END IF;

  IF NOT v_novo_ativo THEN
    RAISE EXCEPTION 'Administrador destino está inativo.';
  END IF;

  IF v_novo_role <> 'admin' OR v_novo_especialidade IS DISTINCT FROM 'geral' THEN
    RAISE EXCEPTION
      'Carteira de fornecedores de Pedidos de Compra só pode ser atribuída a administradores gerais (role=admin, especialidade=geral). % tem role=% e especialidade=%.',
      v_novo_nome, v_novo_role, v_novo_especialidade;
  END IF;

  SELECT c.administrador_id, a.nome, c.fornecedor_nome
  INTO v_anterior_id, v_anterior_nome, v_fornecedor_nome
  FROM public.pedidos_compra_carteira_fornecedor c
  JOIN public.administradores a ON a.id = c.administrador_id
  WHERE c.fornecedor_codigo = v_codigo AND c.ativo = true;

  IF v_fornecedor_nome IS NULL THEN
    RAISE EXCEPTION 'Fornecedor % não está mapeado na carteira de Pedidos de Compra.', v_codigo;
  END IF;

  -- alias "pcc" evita ambiguidade: "fornecedor_codigo" existe como coluna E como OUT param do RETURNS TABLE
  UPDATE public.pedidos_compra_carteira_fornecedor AS pcc
  SET administrador_id = p_novo_admin_id,
      updated_at       = now(),
      updated_by       = p_gestor_id
  WHERE pcc.fornecedor_codigo = v_codigo;

  INSERT INTO public.pedidos_compra_carteira_fornecedor_audit (
    fornecedor_codigo,
    fornecedor_nome,
    admin_anterior_id,
    admin_anterior_nome,
    admin_novo_id,
    admin_novo_nome,
    motivo,
    alterado_por,
    alterado_em
  ) VALUES (
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome,
    p_motivo,
    p_gestor_id,
    now()
  );

  RETURN QUERY SELECT
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome;
END;
$$;

COMMENT ON FUNCTION public.realocar_carteira_fornecedor_pedidos IS
  'Troca o responsável de um fornecedor na carteira de Pedidos de Compra e grava auditoria. Requer gestor. NÃO reatribui pedidos_compra existentes — só muda o dono a partir de agora.';
