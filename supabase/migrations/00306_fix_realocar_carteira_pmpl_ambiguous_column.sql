-- 00306_fix_realocar_carteira_pmpl_ambiguous_column.sql
--
-- realocar_carteira_pmpl_fornecedor (00254) falhava com
-- "column reference fornecedor_codigo is ambiguous" porque os OUT params
-- de RETURNS TABLE colidem em nome com colunas da tabela pmpl_carteira_fornecedor
-- no INSERT ... ON CONFLICT. Nunca tinha sido exercitada em produção até agora
-- (só a Mazurkevs, feita via seed direto, não via RPC).
-- Fix: pragma #variable_conflict use_column para priorizar coluna da tabela.

CREATE OR REPLACE FUNCTION public.realocar_carteira_pmpl_fornecedor(
  p_fornecedor_codigo TEXT,
  p_novo_admin_id     UUID,
  p_gestor_id         UUID,
  p_motivo            TEXT DEFAULT NULL
)
RETURNS TABLE (
  fornecedor_codigo           TEXT,
  fornecedor_nome             TEXT,
  admin_anterior_id           UUID,
  admin_anterior_nome         TEXT,
  admin_novo_id               UUID,
  admin_novo_nome             TEXT,
  qtd_ordens_abertas_afetadas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_codigo              TEXT;
  v_gestor_role         user_role;
  v_novo_admin_ativo    BOOLEAN;
  v_anterior_id         UUID;
  v_anterior_nome       TEXT;
  v_novo_nome           TEXT;
  v_fornecedor_nome     TEXT;
  v_qtd                 INTEGER;
BEGIN
  v_codigo := TRIM(UPPER(p_fornecedor_codigo));

  SELECT role INTO v_gestor_role
  FROM public.administradores
  WHERE id = p_gestor_id;

  IF v_gestor_role IS NULL THEN
    RAISE EXCEPTION 'Gestor não encontrado: %', p_gestor_id;
  END IF;

  IF v_gestor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Apenas gestores podem realocar carteiras PMPL.';
  END IF;

  SELECT ativo INTO v_novo_admin_ativo
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  IF v_novo_admin_ativo IS NULL THEN
    RAISE EXCEPTION 'Administrador destino não encontrado: %', p_novo_admin_id;
  END IF;

  IF NOT v_novo_admin_ativo THEN
    RAISE EXCEPTION 'Administrador destino está inativo.';
  END IF;

  SELECT nome INTO v_novo_nome
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  SELECT c.administrador_id, a.nome, c.fornecedor_nome
  INTO v_anterior_id, v_anterior_nome, v_fornecedor_nome
  FROM public.pmpl_carteira_fornecedor c
  JOIN public.administradores a ON a.id = c.administrador_id
  WHERE c.fornecedor_codigo = v_codigo AND c.ativo = true;

  INSERT INTO public.pmpl_carteira_fornecedor
    (fornecedor_codigo, fornecedor_nome, administrador_id, ativo, atualizado_em, atualizado_por)
  VALUES
    (v_codigo, v_fornecedor_nome, p_novo_admin_id, true, now(), p_gestor_id)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        atualizado_em    = now(),
        atualizado_por   = p_gestor_id;

  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = p_novo_admin_id,
      updated_at       = now()
  WHERE tipo_ordem = 'PMPL'
    AND TRIM(UPPER(fornecedor_codigo)) = v_codigo
    AND status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA');

  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  INSERT INTO public.pmpl_carteira_audit (
    fornecedor_codigo,
    fornecedor_nome,
    admin_anterior_id,
    admin_anterior_nome,
    admin_novo_id,
    admin_novo_nome,
    qtd_ordens_abertas_afetadas,
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
    v_qtd,
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
    v_novo_nome,
    v_qtd;
END;
$$;

COMMENT ON FUNCTION public.realocar_carteira_pmpl_fornecedor IS
  'Troca o responsável de um fornecedor PMPL, reatribui ordens abertas e grava auditoria. Requer gestor.';
