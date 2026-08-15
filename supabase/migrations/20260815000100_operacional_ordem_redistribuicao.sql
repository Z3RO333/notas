-- Redistribuicao de uma unica ordem entre operacionais.
--
-- O pedido reserva uma saida destino e grava um command ledger na mesma
-- transacao. A ordem permanece na saida origem ate o ROTA confirmar. Somente
-- confirmar_redistribuicao_ordem move a linha existente (nunca cria copia).
-- Esta fase nao chama nem declara sincronizacao com SAP.

ALTER TABLE public.operacional_saida_ordens
  ADD COLUMN IF NOT EXISTS ordem_codigo_norm text
  GENERATED ALWAYS AS (
    CASE
      WHEN btrim(ordem_codigo) ~ '^[0-9]+$'
        THEN COALESCE(NULLIF(ltrim(btrim(ordem_codigo), '0'), ''), '0')
      ELSE upper(btrim(ordem_codigo))
    END
  ) STORED;

ALTER TABLE public.operacional_saida_ordens
  ADD COLUMN IF NOT EXISTS atribuicao_ativa boolean NOT NULL DEFAULT true;

-- Historico finalizado/cancelado nao e uma atribuicao atual. O backfill nao
-- escolhe silenciosamente entre duplicatas ativas: a precondicao abaixo aborta
-- a migration para que o conflito seja tratado conscientemente.
UPDATE public.operacional_saida_ordens o
SET atribuicao_ativa = (
  o.resultado IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.operacional_saidas s
    WHERE s.id = o.saida_id
      AND s.status = 'em_rota'::public.saida_operacional_status
  )
);

DO $$
DECLARE
  v_duplicate text;
BEGIN
  SELECT ordem_codigo_norm
  INTO v_duplicate
  FROM public.operacional_saida_ordens
  WHERE atribuicao_ativa
  GROUP BY ordem_codigo_norm
  HAVING count(*) > 1
  LIMIT 1;

  IF v_duplicate IS NOT NULL THEN
    RAISE EXCEPTION
      'Existem atribuicoes ativas duplicadas para a ordem normalizada %. Resolva antes de reaplicar a migration.',
      v_duplicate
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_operacional_ordem_atribuicao_ativa
  ON public.operacional_saida_ordens (ordem_codigo_norm)
  WHERE atribuicao_ativa;

CREATE INDEX IF NOT EXISTS idx_operacional_saida_ordens_ativas_saida
  ON public.operacional_saida_ordens (saida_id)
  WHERE atribuicao_ativa;

CREATE TABLE IF NOT EXISTS public.operacional_ordem_redistribuicoes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key             uuid NOT NULL UNIQUE,
  saida_ordem_id              uuid NOT NULL REFERENCES public.operacional_saida_ordens(id) ON DELETE RESTRICT,
  order_number                text NOT NULL,
  source_cockpit_cargo_id     uuid NOT NULL REFERENCES public.operacional_saidas(id) ON DELETE RESTRICT,
  target_cockpit_cargo_id     uuid NOT NULL REFERENCES public.operacional_saidas(id) ON DELETE RESTRICT,
  source_operational_code     text NOT NULL REFERENCES public.dim_operacionais(codigo) ON DELETE RESTRICT,
  target_operational_code     text NOT NULL REFERENCES public.dim_operacionais(codigo) ON DELETE RESTRICT,
  target_rota_operational_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_operational_name     text NOT NULL,
  target_operational_name     text NOT NULL,
  planned_date                date NOT NULL,
  requested_by_admin_id       uuid NOT NULL REFERENCES public.administradores(id) ON DELETE RESTRICT,
  motivo                      text NOT NULL,
  status                      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'failed', 'completed', 'cancelled')),
  sap_sync_status             text NOT NULL DEFAULT 'not_requested'
    CHECK (sap_sync_status IN ('not_requested', 'pending', 'synced', 'failed')),
  attempt_count               integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processing_started_at       timestamptz,
  next_retry_at               timestamptz,
  last_error                  text,
  rota_transfer_id            text,
  confirmed_by_admin_id       uuid REFERENCES public.administradores(id) ON DELETE RESTRICT,
  completed_at                timestamptz,
  cancelled_by_admin_id       uuid REFERENCES public.administradores(id) ON DELETE RESTRICT,
  cancelled_at                timestamptz,
  cancellation_reason         text,
  target_cargo_was_reserved   boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacional_redistribuicao_operacionais_distintos
    CHECK (source_operational_code <> target_operational_code),
  CONSTRAINT operacional_redistribuicao_saidas_distintas
    CHECK (source_cockpit_cargo_id <> target_cockpit_cargo_id),
  CONSTRAINT operacional_redistribuicao_motivo_valido
    CHECK (char_length(btrim(motivo)) BETWEEN 3 AND 500),
  CONSTRAINT operacional_redistribuicao_erro_limitado
    CHECK (last_error IS NULL OR char_length(last_error) <= 2000)
);

COMMENT ON TABLE public.operacional_ordem_redistribuicoes IS
  'Historico e command ledger Cockpit->ROTA para mover uma ordem entre operacionais. Nao sincroniza SAP nesta fase.';
COMMENT ON COLUMN public.operacional_ordem_redistribuicoes.source_operational_code IS
  'Codigo do operacional/fornecedor SAP na origem, preservado para auditoria e futura integracao SAP.';
COMMENT ON COLUMN public.operacional_ordem_redistribuicoes.target_operational_code IS
  'Codigo do operacional/fornecedor SAP no destino, preservado para auditoria e futura integracao SAP.';
COMMENT ON COLUMN public.operacional_ordem_redistribuicoes.target_rota_operational_id IS
  'auth.users.id do operacional destino congelado na solicitacao e reutilizado em todos os retries do ROTA.';
COMMENT ON COLUMN public.operacional_ordem_redistribuicoes.sap_sync_status IS
  'Sempre not_requested nesta fase; impede que a redistribuicao Cockpit/ROTA seja confundida com sincronizacao SAP.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_redistribuicao_ativa_por_saida_ordem
  ON public.operacional_ordem_redistribuicoes (saida_ordem_id)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE INDEX IF NOT EXISTS idx_redistribuicoes_retry
  ON public.operacional_ordem_redistribuicoes (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_redistribuicoes_source_cargo
  ON public.operacional_ordem_redistribuicoes (source_cockpit_cargo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_redistribuicoes_target_cargo
  ON public.operacional_ordem_redistribuicoes (target_cockpit_cargo_id, created_at DESC);

ALTER TABLE public.operacional_ordem_redistribuicoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operacional_ordem_redistribuicoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.operacional_ordem_redistribuicoes TO service_role;

CREATE OR REPLACE FUNCTION public.redistribuicao_ordem_payload(p_redistribuicao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'command_id', r.id,
    'idempotency_key', r.idempotency_key,
    'status', r.status,
    'source_cockpit_cargo_id', r.source_cockpit_cargo_id,
    'target_cockpit_cargo_id', r.target_cockpit_cargo_id,
    'source_operational_code', r.source_operational_code,
    'target_operational_code', r.target_operational_code,
    'target_rota_operational_id', r.target_rota_operational_id,
    'order_number', r.order_number,
    'reason', r.motivo,
    'planned_date', r.planned_date,
    'attempt_count', r.attempt_count,
    'next_retry_at', r.next_retry_at,
    'rota_transfer_id', r.rota_transfer_id,
    'sap_sync_status', r.sap_sync_status
  )
  FROM public.operacional_ordem_redistribuicoes r
  WHERE r.id = p_redistribuicao_id;
$$;

CREATE OR REPLACE FUNCTION public.solicitar_redistribuicao_ordem(
  p_saida_ordem_id uuid,
  p_novo_operacional_codigo text,
  p_admin_id uuid,
  p_motivo text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ordem public.operacional_saida_ordens%ROWTYPE;
  v_source public.operacional_saidas%ROWTYPE;
  v_existing public.operacional_ordem_redistribuicoes%ROWTYPE;
  v_source_id uuid;
  v_target_id uuid;
  v_target_name text;
  v_target_auth_ids uuid[];
  v_target_auth_user_id uuid;
  v_target_dispatch_id uuid;
  v_command_id uuid;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_source_lock_key text;
  v_target_lock_key text;
BEGIN
  IF p_saida_ordem_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'saida_ordem_id e idempotency_key sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(p_novo_operacional_codigo), '') IS NULL THEN
    RAISE EXCEPTION 'novo_operacional_codigo e obrigatorio' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_motivo) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Motivo deve possuir entre 3 e 500 caracteres' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.administradores a
    WHERE a.id = p_admin_id AND a.ativo
      AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissao' USING ERRCODE = '42501';
  END IF;

  -- Replay exato deve funcionar mesmo depois que a ordem ja foi movida.
  SELECT * INTO v_existing
  FROM public.operacional_ordem_redistribuicoes
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.saida_ordem_id <> p_saida_ordem_id
       OR v_existing.target_operational_code <> btrim(p_novo_operacional_codigo)
       OR v_existing.motivo <> v_motivo THEN
      RAISE EXCEPTION 'Chave de idempotencia ja utilizada com outro payload' USING ERRCODE = '23505';
    END IF;
    RETURN public.redistribuicao_ordem_payload(v_existing.id);
  END IF;

  -- Ordem de locks: cabecalho da saida -> ordem. cancelar_saida_operacional
  -- segue a mesma ordem para evitar deadlock com uma solicitacao concorrente.
  SELECT * INTO v_ordem
  FROM public.operacional_saida_ordens
  WHERE id = p_saida_ordem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem da saida nao encontrada: %', p_saida_ordem_id USING ERRCODE = 'P0002';
  END IF;
  v_source_id := v_ordem.saida_id;

  SELECT * INTO v_source
  FROM public.operacional_saidas
  WHERE id = v_source_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saida origem nao encontrada: %', v_source_id USING ERRCODE = 'P0002';
  END IF;

  IF v_source.operacional_codigo = btrim(p_novo_operacional_codigo) THEN
    RAISE EXCEPTION 'O operacional destino deve ser diferente da origem' USING ERRCODE = '22023';
  END IF;

  -- Locks logicos sao adquiridos em ordem global ANTES dos row locks. Alem de
  -- serializar a reserva por destino/data, isso evita deadlock em swaps A->B e
  -- B->A executados ao mesmo tempo.
  v_source_lock_key := 'cockpit-redistribution-operational:' ||
    v_source.operacional_codigo || ':' ||
    ((v_source.data_saida AT TIME ZONE 'America/Manaus')::date)::text;
  v_target_lock_key := 'cockpit-redistribution-operational:' ||
    btrim(p_novo_operacional_codigo) || ':' ||
    ((v_source.data_saida AT TIME ZONE 'America/Manaus')::date)::text;

  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_source_lock_key, v_target_lock_key), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(greatest(v_source_lock_key, v_target_lock_key), 0));

  -- Reconsulta depois do advisory lock: outra solicitacao pode ter criado o
  -- command enquanto esta esperava. Isso tambem faz retry e confirmacao
  -- concorrentes serializarem pelo ledger antes de qualquer row lock.
  SELECT * INTO v_existing
  FROM public.operacional_ordem_redistribuicoes
  WHERE saida_ordem_id = p_saida_ordem_id
    AND status IN ('pending', 'processing', 'failed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.target_operational_code <> btrim(p_novo_operacional_codigo) THEN
      RAISE EXCEPTION 'A ordem ja possui redistribuicao ativa para outro operacional' USING ERRCODE = '55000';
    END IF;

    IF v_existing.status = 'failed'
       OR (
         v_existing.status = 'processing'
         AND v_existing.processing_started_at < now() - interval '5 minutes'
       ) THEN
      UPDATE public.operacional_ordem_redistribuicoes
      SET status = 'pending',
          processing_started_at = NULL,
          next_retry_at = NULL,
          last_error = NULL,
          updated_at = now()
      WHERE id = v_existing.id;
    END IF;

    RETURN public.redistribuicao_ordem_payload(v_existing.id);
  END IF;

  SELECT * INTO v_source
  FROM public.operacional_saidas
  WHERE id = v_source_id
  FOR UPDATE;

  SELECT * INTO v_ordem
  FROM public.operacional_saida_ordens
  WHERE id = p_saida_ordem_id
  FOR UPDATE;

  IF v_ordem.saida_id <> v_source_id THEN
    RAISE EXCEPTION 'A atribuicao da ordem mudou durante a solicitacao' USING ERRCODE = '40001';
  END IF;

  IF v_source.status <> 'em_rota'::public.saida_operacional_status
     OR v_ordem.resultado IS NOT NULL
     OR NOT v_ordem.atribuicao_ativa THEN
    RAISE EXCEPTION 'A ordem nao possui atribuicao ativa em uma saida em rota' USING ERRCODE = '55000';
  END IF;

  SELECT nome INTO v_target_name
  FROM public.dim_operacionais
  WHERE codigo = btrim(p_novo_operacional_codigo) AND ativo;

  IF v_target_name IS NULL THEN
    RAISE EXCEPTION 'Operacional destino nao encontrado ou inativo: %', p_novo_operacional_codigo USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(a.auth_user_id ORDER BY a.id)
  INTO v_target_auth_ids
  FROM public.administradores a
  WHERE a.operacional_codigo = btrim(p_novo_operacional_codigo)
    AND a.ativo
    AND a.role = 'operacional'::public.user_role
    AND a.auth_user_id IS NOT NULL;

  IF coalesce(cardinality(v_target_auth_ids), 0) <> 1 THEN
    RAISE EXCEPTION
      'Operacional destino deve possuir exatamente um usuario ativo vinculado ao ROTA: %',
      p_novo_operacional_codigo
      USING ERRCODE = '22023';
  END IF;
  v_target_auth_user_id := v_target_auth_ids[1];

  -- Reusa a saida em rota que o portal do operacional trataria como canonica
  -- para a mesma data. Ela precisa estar publicada e ativa no ROTA; do
  -- contrario, mover apenas esta ordem criaria uma rota parcial no destino.
  SELECT s.id INTO v_target_id
  FROM public.operacional_saidas s
  WHERE s.operacional_codigo = btrim(p_novo_operacional_codigo)
    AND s.status = 'em_rota'::public.saida_operacional_status
    AND (s.data_saida AT TIME ZONE 'America/Manaus')::date =
        (v_source.data_saida AT TIME ZONE 'America/Manaus')::date
    AND NOT EXISTS (
      SELECT 1
      FROM public.operacional_saida_ordens target_order
      WHERE target_order.saida_id = s.id
        AND target_order.ordem_codigo_norm = v_ordem.ordem_codigo_norm
    )
  ORDER BY s.data_saida DESC, s.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_target_id IS NOT NULL THEN
    IF to_regclass('integration.route_dispatches') IS NULL
       OR to_regclass('rota.routes') IS NULL THEN
      RAISE EXCEPTION 'Integracao ROTA indisponivel para validar a saida destino'
        USING ERRCODE = '55000';
    END IF;

    SELECT d.id INTO v_target_dispatch_id
    FROM integration.route_dispatches d
    WHERE d.cockpit_cargo_id = v_target_id::text
      AND d.operational_id = v_target_auth_user_id
      AND d.planned_date = (v_source.data_saida AT TIME ZONE 'America/Manaus')::date
      AND d.status IN ('published', 'accepted')
      AND EXISTS (
        SELECT 1
        FROM rota.routes route
        WHERE route.source = 'cockpit'
          AND route.source_reference = d.id::text
          AND route.operational_id = v_target_auth_user_id
          AND route.status IN ('sent', 'accepted', 'in_progress')
      );

    IF v_target_dispatch_id IS NULL THEN
      RAISE EXCEPTION
        'A saida ativa do operacional destino precisa ser publicada no ROTA antes da redistribuicao'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    -- Duas solicitacoes concorrentes sem saida ativa compartilham a mesma
    -- reserva; o primeiro confirm a promove para em_rota.
    SELECT s.id INTO v_target_id
    FROM public.operacional_saidas s
    WHERE s.operacional_codigo = btrim(p_novo_operacional_codigo)
      AND s.status = 'pendente_transferencia'::public.saida_operacional_status
      AND (s.data_saida AT TIME ZONE 'America/Manaus')::date =
          (v_source.data_saida AT TIME ZONE 'America/Manaus')::date
    ORDER BY s.data_saida DESC, s.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_target_id IS NULL THEN
    INSERT INTO public.operacional_saidas (
      operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
      status, data_saida, observacao
    ) VALUES (
      btrim(p_novo_operacional_codigo), v_target_name, p_admin_id,
      'pendente_transferencia'::public.saida_operacional_status,
      v_source.data_saida,
      format('Reservada para redistribuicao da ordem %s a partir da saida %s', v_ordem.ordem_codigo, v_source.id)
    ) RETURNING id INTO v_target_id;
  END IF;

  INSERT INTO public.operacional_ordem_redistribuicoes (
    idempotency_key, saida_ordem_id, order_number,
    source_cockpit_cargo_id, target_cockpit_cargo_id,
    source_operational_code, target_operational_code, target_rota_operational_id,
    source_operational_name, target_operational_name,
    planned_date, requested_by_admin_id, motivo, target_cargo_was_reserved
  ) VALUES (
    p_idempotency_key, v_ordem.id, v_ordem.ordem_codigo,
    v_source.id, v_target_id,
    v_source.operacional_codigo, btrim(p_novo_operacional_codigo), v_target_auth_user_id,
    v_source.operacional_nome_snapshot, v_target_name,
    (v_source.data_saida AT TIME ZONE 'America/Manaus')::date,
    p_admin_id, v_motivo,
    (SELECT status = 'pendente_transferencia'::public.saida_operacional_status
     FROM public.operacional_saidas WHERE id = v_target_id)
  ) RETURNING id INTO v_command_id;

  INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
  VALUES (
    p_admin_id, 'solicitar_redistribuicao_ordem', NULL,
    jsonb_build_object(
      'command_id', v_command_id,
      'order_number', v_ordem.ordem_codigo,
      'source_operational_code', v_source.operacional_codigo,
      'target_operational_code', btrim(p_novo_operacional_codigo),
      'target_rota_operational_id', v_target_auth_user_id,
      'source_cockpit_cargo_id', v_source.id,
      'target_cockpit_cargo_id', v_target_id,
      'sap_sync_status', 'not_requested'
    )
  );

  RETURN public.redistribuicao_ordem_payload(v_command_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.iniciar_redistribuicao_ordem(
  p_redistribuicao_id uuid,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.operacional_ordem_redistribuicoes%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.administradores a
    WHERE a.id = p_admin_id AND a.ativo
      AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissao' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.operacional_ordem_redistribuicoes
  WHERE id = p_redistribuicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redistribuicao nao encontrada: %', p_redistribuicao_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IN ('completed', 'processing') THEN
    RETURN public.redistribuicao_ordem_payload(v_row.id);
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'Redistribuicao cancelada' USING ERRCODE = '55000';
  END IF;

  UPDATE public.operacional_ordem_redistribuicoes
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      processing_started_at = now(),
      next_retry_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  RETURN public.redistribuicao_ordem_payload(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirmar_redistribuicao_ordem(
  p_redistribuicao_id uuid,
  p_admin_id uuid,
  p_rota_transfer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.operacional_ordem_redistribuicoes%ROWTYPE;
  v_ordem public.operacional_saida_ordens%ROWTYPE;
  v_target_status public.saida_operacional_status;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.administradores a
    WHERE a.id = p_admin_id AND a.ativo
      AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissao' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.operacional_ordem_redistribuicoes
  WHERE id = p_redistribuicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redistribuicao nao encontrada: %', p_redistribuicao_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN public.redistribuicao_ordem_payload(v_row.id);
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'Redistribuicao cancelada' USING ERRCODE = '55000';
  END IF;

  IF nullif(btrim(p_rota_transfer_id), '') IS NULL THEN
    RAISE EXCEPTION 'rota_transfer_id e obrigatorio para confirmar' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ordem FROM public.operacional_saida_ordens
  WHERE id = v_row.saida_ordem_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem reservada nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.operacional_saidas
  WHERE id = v_row.source_cockpit_cargo_id FOR UPDATE;

  SELECT status INTO v_target_status FROM public.operacional_saidas
  WHERE id = v_row.target_cockpit_cargo_id FOR UPDATE;

  IF v_target_status NOT IN (
    'pendente_transferencia'::public.saida_operacional_status,
    'em_rota'::public.saida_operacional_status
  ) OR v_target_status IS NULL THEN
    RAISE EXCEPTION 'Saida destino nao esta disponivel para confirmar a transferencia' USING ERRCODE = '55000';
  END IF;

  IF v_ordem.saida_id <> v_row.source_cockpit_cargo_id OR NOT v_ordem.atribuicao_ativa THEN
    RAISE EXCEPTION 'A atribuicao da ordem mudou desde a solicitacao' USING ERRCODE = '40001';
  END IF;

  UPDATE public.operacional_saida_ordens
  SET saida_id = v_row.target_cockpit_cargo_id
  WHERE id = v_row.saida_ordem_id;

  UPDATE public.operacional_saidas
  SET status = 'em_rota'::public.saida_operacional_status,
      data_finalizacao = NULL
  WHERE id = v_row.target_cockpit_cargo_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.operacional_saida_ordens
    WHERE saida_id = v_row.source_cockpit_cargo_id
  ) THEN
    UPDATE public.operacional_saidas
    SET status = 'cancelada'::public.saida_operacional_status,
        data_finalizacao = COALESCE(data_finalizacao, now())
    WHERE id = v_row.source_cockpit_cargo_id
      AND status = 'em_rota'::public.saida_operacional_status;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.operacional_saida_ordens
    WHERE saida_id = v_row.source_cockpit_cargo_id AND atribuicao_ativa
  ) THEN
    UPDATE public.operacional_saidas
    SET status = 'finalizada'::public.saida_operacional_status,
        data_finalizacao = COALESCE(data_finalizacao, now())
    WHERE id = v_row.source_cockpit_cargo_id
      AND status = 'em_rota'::public.saida_operacional_status;
  END IF;

  UPDATE public.operacional_ordem_redistribuicoes
  SET status = 'completed',
      rota_transfer_id = NULLIF(btrim(p_rota_transfer_id), ''),
      confirmed_by_admin_id = p_admin_id,
      completed_at = now(),
      processing_started_at = NULL,
      next_retry_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
  VALUES (
    p_admin_id, 'confirmar_redistribuicao_ordem', NULL,
    jsonb_build_object(
      'command_id', v_row.id,
      'order_number', v_row.order_number,
      'source_operational_code', v_row.source_operational_code,
      'target_operational_code', v_row.target_operational_code,
      'sap_sync_status', 'not_requested'
    )
  );

  RETURN public.redistribuicao_ordem_payload(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_falha_redistribuicao_ordem(
  p_redistribuicao_id uuid,
  p_admin_id uuid,
  p_erro text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.operacional_ordem_redistribuicoes%ROWTYPE;
  v_error text := left(coalesce(nullif(btrim(p_erro), ''), 'Falha nao especificada'), 2000);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.administradores a
    WHERE a.id = p_admin_id AND a.ativo
      AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissao' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.operacional_ordem_redistribuicoes
  WHERE id = p_redistribuicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redistribuicao nao encontrada: %', p_redistribuicao_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IN ('completed', 'cancelled') THEN
    RETURN public.redistribuicao_ordem_payload(v_row.id);
  END IF;

  UPDATE public.operacional_ordem_redistribuicoes
  SET status = 'failed',
      processing_started_at = NULL,
      last_error = v_error,
      next_retry_at = now() + make_interval(
        secs => least(3600, (30 * power(2, greatest(attempt_count - 1, 0)))::integer)
      ),
      updated_at = now()
  WHERE id = v_row.id;

  RETURN public.redistribuicao_ordem_payload(v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_redistribuicao_ordem(
  p_redistribuicao_id uuid,
  p_admin_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.operacional_ordem_redistribuicoes%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.administradores a
    WHERE a.id = p_admin_id AND a.ativo
      AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: administrador ativo sem permissao' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.operacional_ordem_redistribuicoes
  WHERE id = p_redistribuicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redistribuicao nao encontrada: %', p_redistribuicao_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'cancelled' THEN
    RETURN public.redistribuicao_ordem_payload(v_row.id);
  END IF;
  IF v_row.status = 'completed' THEN
    RAISE EXCEPTION 'Redistribuicao concluida nao pode ser cancelada' USING ERRCODE = '55000';
  END IF;
  IF v_row.status = 'processing' THEN
    RAISE EXCEPTION 'Redistribuicao em processamento nao pode ser cancelada' USING ERRCODE = '55000';
  END IF;

  UPDATE public.operacional_ordem_redistribuicoes
  SET status = 'cancelled',
      cancelled_by_admin_id = p_admin_id,
      cancelled_at = now(),
      cancellation_reason = nullif(btrim(p_motivo), ''),
      processing_started_at = NULL,
      next_retry_at = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  UPDATE public.operacional_saidas s
  SET status = 'cancelada'::public.saida_operacional_status,
      data_finalizacao = COALESCE(data_finalizacao, now())
  WHERE s.id = v_row.target_cockpit_cargo_id
    AND s.status = 'pendente_transferencia'::public.saida_operacional_status
    AND NOT EXISTS (
      SELECT 1 FROM public.operacional_saida_ordens o WHERE o.saida_id = s.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.operacional_ordem_redistribuicoes other
      WHERE other.target_cockpit_cargo_id = s.id
        AND other.id <> v_row.id
        AND other.status IN ('pending', 'processing', 'failed')
    );

  RETURN public.redistribuicao_ordem_payload(v_row.id);
END;
$$;

-- Protege a atribuicao local enquanto o comando externo esta em voo.
CREATE OR REPLACE FUNCTION public.cancelar_saida_operacional(p_saida_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.saida_operacional_status;
BEGIN
  SELECT status INTO v_status
  FROM public.operacional_saidas
  WHERE id = p_saida_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'em_rota'::public.saida_operacional_status THEN
    RAISE EXCEPTION 'Saida nao encontrada ou nao esta em rota: %', p_saida_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.operacional_ordem_redistribuicoes r
    WHERE (r.source_cockpit_cargo_id = p_saida_id OR r.target_cockpit_cargo_id = p_saida_id)
      AND r.status IN ('pending', 'processing', 'failed')
  ) THEN
    RAISE EXCEPTION 'Saida possui redistribuicao pendente' USING ERRCODE = '55000';
  END IF;

  UPDATE public.operacional_saidas
  SET status = 'cancelada'::public.saida_operacional_status,
      data_finalizacao = COALESCE(data_finalizacao, now())
  WHERE id = p_saida_id AND status = 'em_rota'::public.saida_operacional_status;

  UPDATE public.operacional_saida_ordens
  SET atribuicao_ativa = false
  WHERE saida_id = p_saida_id AND atribuicao_ativa;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_resultado_ordem(
  p_saida_ordem_id uuid,
  p_resultado public.saida_ordem_resultado,
  p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saida_id uuid;
  v_status public.saida_operacional_status;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.operacional_ordem_redistribuicoes r
    WHERE r.saida_ordem_id = p_saida_ordem_id
      AND r.status IN ('pending', 'processing', 'failed')
  ) THEN
    RAISE EXCEPTION 'Ordem possui redistribuicao pendente' USING ERRCODE = '55000';
  END IF;

  SELECT saida_id INTO v_saida_id
  FROM public.operacional_saida_ordens
  WHERE id = p_saida_ordem_id;

  SELECT status INTO v_status
  FROM public.operacional_saidas
  WHERE id = v_saida_id
  FOR UPDATE;

  PERFORM 1
  FROM public.operacional_saida_ordens
  WHERE id = p_saida_ordem_id
    AND saida_id = v_saida_id
    AND atribuicao_ativa
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'em_rota'::public.saida_operacional_status THEN
    RAISE EXCEPTION 'Saida nao esta em rota ou ordem nao encontrada';
  END IF;

  -- Reconsulta depois dos locks para cobrir a solicitacao que estava sem
  -- commit durante a primeira verificacao.
  IF EXISTS (
    SELECT 1 FROM public.operacional_ordem_redistribuicoes r
    WHERE r.saida_ordem_id = p_saida_ordem_id
      AND r.status IN ('pending', 'processing', 'failed')
  ) THEN
    RAISE EXCEPTION 'Ordem possui redistribuicao pendente' USING ERRCODE = '55000';
  END IF;

  UPDATE public.operacional_saida_ordens
  SET resultado = p_resultado,
      observacao_retorno = p_observacao,
      data_resultado = now(),
      atribuicao_ativa = false
  WHERE id = p_saida_ordem_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem nao encontrada: %', p_saida_ordem_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.redistribuicao_ordem_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.solicitar_redistribuicao_ordem(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.iniciar_redistribuicao_ordem(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_redistribuicao_ordem(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_falha_redistribuicao_ordem(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_redistribuicao_ordem(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_saida_operacional(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_resultado_ordem(uuid, public.saida_ordem_resultado, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.redistribuicao_ordem_payload(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.solicitar_redistribuicao_ordem(uuid, text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_redistribuicao_ordem(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_redistribuicao_ordem(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_falha_redistribuicao_ordem(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_redistribuicao_ordem(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_saida_operacional(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_resultado_ordem(uuid, public.saida_ordem_resultado, text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.operacional_ordem_redistribuicoes'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS nao foi habilitado em operacional_ordem_redistribuicoes';
  END IF;

  IF has_table_privilege('anon', 'public.operacional_ordem_redistribuicoes', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.operacional_ordem_redistribuicoes', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Privileges indevidos detectados no ledger de redistribuicao';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
