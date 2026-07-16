-- 00310_harden_reatribuir_nota_and_fix_10177662.sql
--
-- 1. Fecha a escalada de privilegio em reatribuir_nota: uma chamada authenticated
--    nao pode mais informar o UUID de outro gestor em p_gestor_id. Service role
--    continua permitida explicitamente para automacoes confiaveis, mas ainda deve
--    informar um gestor ativo para manter a identidade de auditoria do RPC.
-- 2. Endurece os criterios do destino sem restringir a especialidade, pois o RPC
--    tambem atende reatribuicoes legitimas para especialistas.
-- 3. Corrige somente a nota 10177662, se ainda estiver com Brenda, escolhendo o
--    administrador geral elegivel com menor carga aberta. A correcao e atomica,
--    idempotente e auditada como acao de sistema (sem personificar um gestor).

CREATE OR REPLACE FUNCTION public.reatribuir_nota(
  p_nota_id UUID,
  p_novo_admin_id UUID,
  p_gestor_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS public.notas_manutencao
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota public.notas_manutencao;
  v_old_admin_id UUID;
  v_request_role TEXT := COALESCE(auth.role(), '');
BEGIN
  IF v_request_role = 'authenticated' THEN
    PERFORM 1
    FROM public.administradores AS g
    WHERE g.id = p_gestor_id
      AND g.auth_user_id = auth.uid()
      AND g.role = 'gestor'
      AND g.ativo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gestor invalido para reatribuicao ou diferente da sessao autenticada';
    END IF;
  ELSIF v_request_role = 'service_role' THEN
    PERFORM 1
    FROM public.administradores AS g
    WHERE g.id = p_gestor_id
      AND g.role = 'gestor'
      AND g.ativo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gestor invalido para auditoria da reatribuicao via service role';
    END IF;
  ELSE
    RAISE EXCEPTION 'Role de banco nao autorizada para reatribuir nota';
  END IF;

  -- Serializa com a distribuicao automatica e com o backfill pontual abaixo.
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  SELECT nm.*
  INTO v_nota
  FROM public.notas_manutencao AS nm
  WHERE nm.id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota % nao encontrada', p_nota_id;
  END IF;

  v_old_admin_id := v_nota.administrador_id;

  IF v_old_admin_id IS NOT NULL AND v_old_admin_id = p_novo_admin_id THEN
    RAISE EXCEPTION 'Novo responsavel deve ser diferente do atual';
  END IF;

  PERFORM 1
  FROM public.administradores AS a
  WHERE a.id = p_novo_admin_id
    AND a.role = 'admin'
    AND a.ativo = true
    AND a.em_ferias = false
    AND a.recebe_distribuicao = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destino invalido: admin deve estar ativo, receber distribuicao e estar fora de ferias';
  END IF;

  UPDATE public.notas_manutencao
  SET administrador_id = p_novo_admin_id,
      distribuida_em = now(),
      updated_at = now()
  WHERE id = p_nota_id
  RETURNING * INTO v_nota;

  INSERT INTO public.notas_historico (
    nota_id,
    campo_alterado,
    valor_anterior,
    valor_novo,
    alterado_por,
    motivo
  )
  VALUES (
    p_nota_id,
    'administrador_id',
    COALESCE(v_old_admin_id::TEXT, 'NULL'),
    p_novo_admin_id::TEXT,
    p_gestor_id,
    COALESCE(NULLIF(BTRIM(p_motivo), ''), 'Reatribuicao manual pelo gestor')
  );

  IF v_old_admin_id IS NOT NULL THEN
    INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
    VALUES (p_nota_id, v_old_admin_id, 'reatribuicao')
    ON CONFLICT (nota_id, administrador_id) DO NOTHING;
  END IF;

  RETURN v_nota;
END;
$$;

REVOKE ALL ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reatribuir_nota(UUID, UUID, UUID, TEXT) TO service_role;

DO $$
DECLARE
  v_nota public.notas_manutencao;
  v_owner_email TEXT;
  v_destino_id UUID;
  v_destino_nome TEXT;
  v_destino_score INTEGER;
  v_destino_qtd_abertas INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  SELECT nm.*
  INTO v_nota
  FROM public.notas_manutencao AS nm
  WHERE nm.numero_nota = '10177662'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correcao 00310 abortada: nota 10177662 nao encontrada';
  END IF;

  SELECT owner.email
  INTO v_owner_email
  FROM public.administradores AS owner
  WHERE owner.id = v_nota.administrador_id;

  -- Reaplicar a migration depois da correcao deve ser um no-op seguro.
  IF EXISTS (
    SELECT 1
    FROM public.administradores AS atual
    WHERE atual.id = v_nota.administrador_id
      AND atual.role = 'admin'
      AND atual.ativo = true
      AND atual.em_ferias = false
      AND atual.recebe_distribuicao = true
      AND atual.especialidade = 'geral'
  ) THEN
    RAISE NOTICE 'Nota 10177662 ja esta com um administrador geral elegivel; nenhuma alteracao aplicada';
    RETURN;
  END IF;

  -- Nao sobrescreve uma mudanca concorrente ou uma correcao manual diferente.
  IF v_owner_email IS DISTINCT FROM 'brendafonseca@bemol.com.br' THEN
    RAISE EXCEPTION
      'Correcao 00310 abortada: responsavel atual da nota 10177662 nao e Brenda (email atual: %)',
      COALESCE(v_owner_email, 'NULL');
  END IF;

  -- O diagnostico que motivou esta correcao era de uma nota aberta e sem ordem.
  -- A view canonica impede aplicar o backfill se esse estado mudou antes do deploy.
  IF NOT EXISTS (
    SELECT 1
    FROM public.vw_notas_sem_ordem AS painel
    WHERE painel.id = v_nota.id
  ) THEN
    RAISE EXCEPTION
      'Correcao 00310 abortada: nota 10177662 nao esta mais aberta e sem ordem na view canonica';
  END IF;

  -- Trava o cadastro dos candidatos antes de escolher o de menor carga.
  PERFORM 1
  FROM public.administradores AS candidato
  WHERE candidato.role = 'admin'
    AND candidato.ativo = true
    AND candidato.em_ferias = false
    AND candidato.recebe_distribuicao = true
    AND candidato.especialidade = 'geral'
  FOR UPDATE;

  SELECT
    carga.id,
    carga.nome,
    carga.score_carga,
    carga.qtd_abertas
  INTO v_destino_id, v_destino_nome, v_destino_score, v_destino_qtd_abertas
  FROM public.vw_carga_real_administradores AS carga
  JOIN public.administradores AS candidato ON candidato.id = carga.id
  WHERE candidato.role = 'admin'
    AND candidato.ativo = true
    AND candidato.em_ferias = false
    AND candidato.recebe_distribuicao = true
    AND candidato.especialidade = 'geral'
    AND carga.qtd_abertas < candidato.max_notas
  ORDER BY carga.score_carga, carga.qtd_abertas, carga.nome, carga.id
  LIMIT 1;

  IF v_destino_id IS NULL THEN
    RAISE EXCEPTION 'Correcao 00310 abortada: nenhum administrador geral elegivel com capacidade disponivel';
  END IF;

  UPDATE public.notas_manutencao
  SET administrador_id = v_destino_id,
      distribuida_em = now(),
      updated_at = now()
  WHERE id = v_nota.id
    AND administrador_id = v_nota.administrador_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correcao 00310 abortada: nota 10177662 mudou de responsavel durante a transacao';
  END IF;

  INSERT INTO public.notas_historico (
    nota_id,
    campo_alterado,
    valor_anterior,
    valor_novo,
    alterado_por,
    motivo
  )
  VALUES (
    v_nota.id,
    'administrador_id',
    v_nota.administrador_id::TEXT,
    v_destino_id::TEXT,
    NULL,
    format(
      'Correcao automatica migration 00310: nota eletrica do CD direcionada ao pool geral; destino %s; score_carga=%s; qtd_abertas=%s',
      v_destino_nome,
      v_destino_score,
      v_destino_qtd_abertas
    )
  );

  INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
  VALUES (v_nota.id, v_nota.administrador_id, 'correcao_migration_00310')
  ON CONFLICT (nota_id, administrador_id) DO NOTHING;

  RAISE NOTICE
    'Nota 10177662 reatribuida de Brenda para % (score: %, notas abertas: %)',
    v_destino_nome,
    v_destino_score,
    v_destino_qtd_abertas;
END;
$$;
