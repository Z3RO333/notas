-- 00313_add_service_role_rpc_identity.sql
--
-- Adiciona contratos exclusivos de service_role para as duas RPCs que ainda
-- dependiam da identidade JWT do Supabase Auth. Os contratos antigos ficam
-- temporariamente intactos para permitir rollout sem indisponibilidade:
-- migration aditiva -> deploy do Cockpit -> revogação na 00314.

CREATE OR REPLACE FUNCTION public.marcar_nota_em_geracao_service(
  p_nota_id UUID,
  p_actor_id UUID,
  p_force_override BOOLEAN DEFAULT false,
  p_trigger TEXT DEFAULT 'copy_button'
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.user_role;
  v_actor_email TEXT;
  v_nota_numero TEXT;
  v_nota_status public.nota_status;
  v_state public.notas_operacao_estado%ROWTYPE;
  v_prev_status public.nota_status_operacional;
  v_action TEXT := 'copy_intent_marked';
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_nota_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'invalid_note_id',
      'message', 'notaId obrigatório.'
    );
  END IF;

  SELECT a.id, a.role, a.email
  INTO v_actor_id, v_actor_role, v_actor_email
  FROM public.administradores a
  WHERE a.id = p_actor_id
    AND a.ativo = true
    AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissão.'
      USING ERRCODE = '42501';
  END IF;

  SELECT n.numero_nota, n.status
  INTO v_nota_numero, v_nota_status
  FROM public.notas_manutencao n
  WHERE n.id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'nota_not_found',
      'message', 'Nota não encontrada.'
    );
  END IF;

  IF v_nota_status NOT IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'nota_not_open',
      'message', 'Nota não está aberta para geração de ordem.'
    );
  END IF;

  IF public._has_active_order_for_note(p_nota_id, v_nota_numero) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'already_has_order',
      'message', 'Nota já possui ordem ativa vinculada.'
    );
  END IF;

  INSERT INTO public.notas_operacao_estado (
    nota_id,
    numero_nota,
    status_operacional
  )
  VALUES (
    p_nota_id,
    v_nota_numero,
    'PENDENTE'
  )
  ON CONFLICT (nota_id) DO NOTHING;

  SELECT *
  INTO v_state
  FROM public.notas_operacao_estado s
  WHERE s.nota_id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'state_not_found',
      'message', 'Estado operacional da nota não encontrado.'
    );
  END IF;

  v_prev_status := v_state.status_operacional;

  IF v_state.status_operacional = 'EM_GERACAO'
     AND v_state.em_geracao_por_admin_id IS NOT NULL
     AND v_state.em_geracao_por_admin_id IS DISTINCT FROM v_actor_id THEN
    IF v_actor_role <> 'gestor'::public.user_role OR p_force_override IS DISTINCT FROM true THEN
      INSERT INTO public.copy_intent_log (
        nota_id,
        numero_nota,
        ator_admin_id,
        ator_email,
        acao,
        detalhes
      )
      VALUES (
        p_nota_id,
        v_nota_numero,
        v_actor_id,
        v_actor_email,
        'copy_intent_conflict',
        jsonb_build_object(
          'status_anterior', v_state.status_operacional,
          'owner_admin_id', v_state.em_geracao_por_admin_id,
          'owner_email', v_state.em_geracao_por_email,
          'force_requested', p_force_override
        )
      );

      RETURN jsonb_build_object(
        'ok', false,
        'code', 'already_in_progress_by_other',
        'message', 'Nota já está em geração por outro responsável.',
        'owner_admin_id', v_state.em_geracao_por_admin_id,
        'owner_email', v_state.em_geracao_por_email,
        'can_override', v_actor_role = 'gestor'::public.user_role
      );
    END IF;

    v_action := 'copy_intent_override';
  END IF;

  UPDATE public.notas_operacao_estado
  SET
    numero_nota = v_nota_numero,
    status_operacional = 'EM_GERACAO',
    em_geracao_por_admin_id = v_actor_id,
    em_geracao_por_email = v_actor_email,
    em_geracao_em = v_now,
    ultima_copia_em = v_now,
    updated_at = v_now
  WHERE nota_id = p_nota_id
  RETURNING *
  INTO v_state;

  INSERT INTO public.copy_intent_log (
    nota_id,
    numero_nota,
    ator_admin_id,
    ator_email,
    acao,
    detalhes
  )
  VALUES (
    p_nota_id,
    v_nota_numero,
    v_actor_id,
    v_actor_email,
    v_action,
    jsonb_build_object(
      'trigger', COALESCE(NULLIF(BTRIM(p_trigger), ''), 'copy_button'),
      'force_override', COALESCE(p_force_override, false),
      'status_anterior', COALESCE(v_prev_status::TEXT, 'PENDENTE')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', CASE WHEN v_action = 'copy_intent_override' THEN 'overridden' ELSE 'marked' END,
    'nota_id', v_state.nota_id,
    'numero_nota', v_state.numero_nota,
    'status_operacional', v_state.status_operacional,
    'em_geracao_por_admin_id', v_state.em_geracao_por_admin_id,
    'em_geracao_por_email', v_state.em_geracao_por_email,
    'em_geracao_em', v_state.em_geracao_em,
    'ultima_copia_em', v_state.ultima_copia_em,
    'ttl_minutos', v_state.ttl_minutos,
    'numero_ordem_confirmada', v_state.numero_ordem_confirmada,
    'confirmada_em', v_state.confirmada_em
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.marcar_nota_em_geracao_service(uuid, uuid, boolean, text)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.marcar_nota_em_geracao_service(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_nota_em_geracao_service(uuid, uuid, boolean, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.buscar_ordens_fornecedor_global_service(
  p_q TEXT,
  p_admin_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  ordem_id UUID,
  nota_id UUID,
  numero_nota TEXT,
  ordem_codigo TEXT,
  administrador_id UUID,
  administrador_nome TEXT,
  responsavel_atual_id UUID,
  responsavel_atual_nome TEXT,
  centro TEXT,
  unidade TEXT,
  status_ordem TEXT,
  status_ordem_raw TEXT,
  ordem_detectada_em TIMESTAMPTZ,
  status_atualizado_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  qtd_historico BIGINT,
  tem_historico BOOLEAN,
  dias_em_aberto INTEGER,
  semaforo_atraso TEXT,
  envolvidos_admin_ids UUID[],
  descricao TEXT,
  tipo_ordem TEXT,
  hora_nota TEXT,
  fornecedor_codigo TEXT,
  fornecedor_nome TEXT,
  data_entrada TIMESTAMPTZ,
  texto_breve TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role public.user_role;
  v_q TEXT := BTRIM(COALESCE(p_q, ''));
  v_probe TEXT;
  v_like TEXT;
  v_like_unaccent TEXT;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_result_count INTEGER := 0;
BEGIN
  SELECT a.role
    INTO v_admin_role
  FROM public.administradores a
  WHERE a.id = p_admin_id
    AND a.ativo = true
    AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  LIMIT 1;

  IF v_admin_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao para localizar ordens por fornecedor'
      USING ERRCODE = '42501';
  END IF;

  v_probe := regexp_replace(v_q, '[\s%_\\]+', '', 'g');
  IF length(v_probe) < 3 THEN
    RAISE EXCEPTION 'Informe pelo menos 3 caracteres para buscar fornecedor'
      USING ERRCODE = '22023';
  END IF;

  v_like := '%' ||
    replace(
      replace(
        replace(v_q, E'\\', E'\\\\'),
        '%',
        E'\\%'
      ),
      '_',
      E'\\_'
    ) ||
    '%';
  v_like_unaccent := public.unaccent(v_like);

  RETURN QUERY
  WITH matched AS (
    SELECT
      v.ordem_id,
      v.nota_id,
      v.numero_nota,
      v.ordem_codigo,
      v.administrador_id,
      v.administrador_nome,
      v.responsavel_atual_id,
      v.responsavel_atual_nome,
      v.centro,
      v.unidade,
      v.status_ordem::TEXT,
      v.status_ordem_raw,
      v.ordem_detectada_em,
      v.status_atualizado_em,
      v.dias_para_gerar_ordem,
      v.qtd_historico,
      v.tem_historico,
      v.dias_em_aberto,
      v.semaforo_atraso::TEXT,
      v.envolvidos_admin_ids,
      v.descricao,
      v.tipo_ordem,
      v.hora_nota,
      NULLIF(BTRIM(o.fornecedor_codigo), '') AS fornecedor_codigo,
      COALESCE(df.nome, NULLIF(BTRIM(o.fornecedor_nome), ''), NULLIF(BTRIM(o.fornecedor_codigo), '')) AS fornecedor_nome,
      v.ordem_detectada_em AS data_entrada,
      v.descricao AS texto_breve
    FROM public.vw_ordens_notas_painel v
    JOIN public.ordens_notas_acompanhamento o
      ON o.id = v.ordem_id
    LEFT JOIN public.dim_fornecedores df
      ON public.normalize_supplier_code(df.codigo) = public.normalize_supplier_code(o.fornecedor_codigo)
    WHERE o.fornecedor_codigo ILIKE v_like ESCAPE '\'
       OR o.fornecedor_nome ILIKE v_like ESCAPE '\'
       OR df.nome ILIKE v_like ESCAPE '\'
       OR public.unaccent(COALESCE(o.fornecedor_nome, '')) ILIKE v_like_unaccent ESCAPE '\'
       OR public.unaccent(COALESCE(df.nome, '')) ILIKE v_like_unaccent ESCAPE '\'
    ORDER BY
      CASE WHEN public.status_raw_eh_final(v.status_ordem_raw) THEN 1 ELSE 0 END,
      v.ordem_detectada_em DESC,
      v.ordem_codigo
    LIMIT v_limit
  )
  SELECT * FROM matched;

  GET DIAGNOSTICS v_result_count = ROW_COUNT;

  INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
  VALUES (
    p_admin_id,
    'buscar_ordens_fornecedor_global',
    NULL,
    jsonb_build_object(
      'termo', v_q,
      'limite', v_limit,
      'qtd_resultados', v_result_count,
      'role', v_admin_role
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_ordens_fornecedor_global_service(text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_ordens_fornecedor_global_service(text, uuid, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
