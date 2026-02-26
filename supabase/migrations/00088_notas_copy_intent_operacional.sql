-- 00088_notas_copy_intent_operacional.sql
--
-- Objetivo:
-- 1) Persistir estado operacional de copy intent em tabela dedicada
-- 2) Criar RPC segura para marcar nota como EM_GERACAO
-- 3) Criar RPC de reconciliacao (TTL + confirmacao por ordem + repair)
-- 4) Garantir observabilidade sem poluir distribuicao_log

-- ============================================================
-- 1) Enum operacional de copy intent
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'nota_status_operacional'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.nota_status_operacional AS ENUM (
      'PENDENTE',
      'EM_GERACAO',
      'ALERTA',
      'CONFIRMADA_VIROU_ORDEM'
    );
  END IF;
END;
$$;

-- ============================================================
-- 2) Estado operacional por nota
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notas_operacao_estado (
  nota_id UUID PRIMARY KEY REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  numero_nota TEXT NOT NULL,
  status_operacional public.nota_status_operacional NOT NULL DEFAULT 'PENDENTE',
  em_geracao_por_admin_id UUID REFERENCES public.administradores(id),
  em_geracao_por_email TEXT,
  em_geracao_em TIMESTAMPTZ,
  ultima_copia_em TIMESTAMPTZ,
  ttl_minutos INTEGER NOT NULL DEFAULT 60,
  numero_ordem_confirmada TEXT,
  confirmada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notas_operacao_estado_updated'
  ) THEN
    CREATE TRIGGER trg_notas_operacao_estado_updated
      BEFORE UPDATE ON public.notas_operacao_estado
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

-- ============================================================
-- 3) Log dedicado de copy intent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.copy_intent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  numero_nota TEXT NOT NULL,
  ator_admin_id UUID REFERENCES public.administradores(id),
  ator_email TEXT,
  acao TEXT NOT NULL,
  detalhes JSONB NOT NULL DEFAULT '{}'::JSONB,
  sync_id UUID REFERENCES public.sync_log(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_operacao_estado_status_em_geracao
  ON public.notas_operacao_estado (status_operacional, em_geracao_em DESC);

CREATE INDEX IF NOT EXISTS idx_notas_operacao_estado_updated_at
  ON public.notas_operacao_estado (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_copy_intent_log_nota_created_at
  ON public.copy_intent_log (nota_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copy_intent_log_acao_created_at
  ON public.copy_intent_log (acao, created_at DESC);

-- ============================================================
-- 4) RLS
-- ============================================================
ALTER TABLE public.notas_operacao_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_intent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin ve estado operacional proprio e gestor ve tudo" ON public.notas_operacao_estado;
CREATE POLICY "Admin ve estado operacional proprio e gestor ve tudo"
  ON public.notas_operacao_estado FOR SELECT TO authenticated
  USING (
    get_my_role() = 'gestor'::user_role
    OR EXISTS (
      SELECT 1
      FROM public.notas_manutencao n
      WHERE n.id = notas_operacao_estado.nota_id
        AND n.administrador_id = get_my_admin_id()
    )
  );

DROP POLICY IF EXISTS "Gestor ve copy intent log" ON public.copy_intent_log;
CREATE POLICY "Gestor ve copy intent log"
  ON public.copy_intent_log FOR SELECT TO authenticated
  USING (get_my_role() = 'gestor'::user_role);

-- ============================================================
-- 5) Helper interno: ordem ativa vinculada por nota_id ou numero_nota
-- ============================================================
CREATE OR REPLACE FUNCTION public._has_active_order_for_note(
  p_nota_id UUID,
  p_numero_nota TEXT
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.status_ordem NOT IN ('concluida', 'cancelada')
      AND (
        o.nota_id = p_nota_id
        OR (
          o.nota_id IS NULL
          AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
              = COALESCE(NULLIF(LTRIM(BTRIM(p_numero_nota), '0'), ''), '0')
        )
      )
  );
$$ LANGUAGE sql STABLE;

ALTER FUNCTION public._has_active_order_for_note(uuid, text)
  SET search_path = public;

REVOKE ALL ON FUNCTION public._has_active_order_for_note(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._has_active_order_for_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._has_active_order_for_note(uuid, text) TO service_role;

-- ============================================================
-- 6) RPC: marcar nota em geração
-- ============================================================
CREATE OR REPLACE FUNCTION public.marcar_nota_em_geracao(
  p_nota_id UUID,
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
  WHERE a.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário autenticado sem administrador vinculado.'
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

ALTER FUNCTION public.marcar_nota_em_geracao(uuid, boolean, text)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.marcar_nota_em_geracao(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_nota_em_geracao(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_nota_em_geracao(uuid, boolean, text) TO service_role;

-- ============================================================
-- 7) RPC: reconciliar estados operacionais
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconciliar_notas_em_geracao(
  p_sync_id UUID DEFAULT NULL,
  p_ttl_minutes INTEGER DEFAULT 60,
  p_confirm_repair_minutes INTEGER DEFAULT 15
)
RETURNS JSONB AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_ttl_minutes_safe INTEGER := GREATEST(COALESCE(p_ttl_minutes, 60), 1);
  v_repair_minutes_safe INTEGER := GREATEST(COALESCE(p_confirm_repair_minutes, 15), 1);
  v_em_geracao_to_alerta INTEGER := 0;
  v_confirmadas INTEGER := 0;
  v_confirm_repaired INTEGER := 0;
BEGIN
  WITH updated AS (
    UPDATE public.notas_operacao_estado s
    SET
      status_operacional = 'ALERTA',
      updated_at = v_now
    WHERE s.status_operacional = 'EM_GERACAO'
      AND s.em_geracao_em IS NOT NULL
      AND v_now >= (
        s.em_geracao_em
        + make_interval(mins => GREATEST(COALESCE(NULLIF(s.ttl_minutos, 0), v_ttl_minutes_safe), 1))
      )
      AND NOT public._has_active_order_for_note(s.nota_id, s.numero_nota)
    RETURNING
      s.nota_id,
      s.numero_nota,
      GREATEST(COALESCE(NULLIF(s.ttl_minutos, 0), v_ttl_minutes_safe), 1) AS ttl_minutes_used
  )
  INSERT INTO public.copy_intent_log (
    nota_id,
    numero_nota,
    acao,
    detalhes,
    sync_id
  )
  SELECT
    u.nota_id,
    u.numero_nota,
    'ttl_alert',
    jsonb_build_object(
      'ttl_minutes', u.ttl_minutes_used,
      'reconciled_at', v_now
    ),
    p_sync_id
  FROM updated u;
  GET DIAGNOSTICS v_em_geracao_to_alerta = ROW_COUNT;

  WITH candidates AS (
    SELECT
      s.nota_id,
      s.numero_nota,
      o_match.ordem_codigo
    FROM public.notas_operacao_estado s
    JOIN LATERAL (
      SELECT o.ordem_codigo
      FROM public.ordens_notas_acompanhamento o
      WHERE o.status_ordem NOT IN ('concluida', 'cancelada')
        AND (
          o.nota_id = s.nota_id
          OR (
            o.nota_id IS NULL
            AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
                = COALESCE(NULLIF(LTRIM(BTRIM(s.numero_nota), '0'), ''), '0')
          )
        )
      ORDER BY o.ordem_detectada_em DESC NULLS LAST, o.updated_at DESC NULLS LAST
      LIMIT 1
    ) o_match ON true
    WHERE s.status_operacional IN ('EM_GERACAO', 'ALERTA')
  ),
  updated AS (
    UPDATE public.notas_operacao_estado s
    SET
      status_operacional = 'CONFIRMADA_VIROU_ORDEM',
      numero_ordem_confirmada = c.ordem_codigo,
      confirmada_em = COALESCE(s.confirmada_em, v_now),
      updated_at = v_now
    FROM candidates c
    WHERE s.nota_id = c.nota_id
    RETURNING
      s.nota_id,
      s.numero_nota,
      c.ordem_codigo
  )
  INSERT INTO public.copy_intent_log (
    nota_id,
    numero_nota,
    acao,
    detalhes,
    sync_id
  )
  SELECT
    u.nota_id,
    u.numero_nota,
    'reconciled_confirmed',
    jsonb_build_object(
      'numero_ordem', u.ordem_codigo,
      'reconciled_at', v_now
    ),
    p_sync_id
  FROM updated u;
  GET DIAGNOSTICS v_confirmadas = ROW_COUNT;

  WITH updated AS (
    UPDATE public.notas_operacao_estado s
    SET
      status_operacional = 'PENDENTE',
      em_geracao_por_admin_id = NULL,
      em_geracao_por_email = NULL,
      em_geracao_em = NULL,
      numero_ordem_confirmada = NULL,
      confirmada_em = NULL,
      updated_at = v_now
    WHERE s.status_operacional = 'CONFIRMADA_VIROU_ORDEM'
      AND COALESCE(s.confirmada_em, s.updated_at, s.created_at)
          <= v_now - make_interval(mins => v_repair_minutes_safe)
      AND NOT public._has_active_order_for_note(s.nota_id, s.numero_nota)
    RETURNING
      s.nota_id,
      s.numero_nota
  )
  INSERT INTO public.copy_intent_log (
    nota_id,
    numero_nota,
    acao,
    detalhes,
    sync_id
  )
  SELECT
    u.nota_id,
    u.numero_nota,
    'confirmed_repair',
    jsonb_build_object(
      'repair_minutes', v_repair_minutes_safe,
      'reconciled_at', v_now
    ),
    p_sync_id
  FROM updated u;
  GET DIAGNOSTICS v_confirm_repaired = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'processed_at', v_now,
    'ttl_minutes', v_ttl_minutes_safe,
    'confirm_repair_minutes', v_repair_minutes_safe,
    'em_geracao_to_alerta', v_em_geracao_to_alerta,
    'confirmadas', v_confirmadas,
    'confirm_repaired', v_confirm_repaired
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.reconciliar_notas_em_geracao(uuid, integer, integer)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.reconciliar_notas_em_geracao(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconciliar_notas_em_geracao(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_notas_em_geracao(uuid, integer, integer) TO service_role;

-- ============================================================
-- 8) Realtime: incluir tabela operacional na publication
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_publication p ON p.oid = pr.prpubid
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
        AND c.relname = 'notas_operacao_estado'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notas_operacao_estado;
    END IF;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END;
$$;
