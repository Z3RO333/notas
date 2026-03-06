-- 00119_remove_janela_48h_sap_aux.sql
--
-- Problema:
--   As filtragens de notas_status_sap_aux em vw_notas_sem_ordem,
--   distribuir_notas e sincronizar_cockpit_convergencia usavam
--   "AND aux.importado_em >= now() - interval '48 hours'".
--   Isso fazia o filtro expirar 48h após a última importação.
--   Resultado: notas CANCELADAS/VIROU_ORDEM voltariam a aparecer
--   no painel se o job não rodasse no fim de semana.
--
-- Solução:
--   Remover a janela de frescor. O dado mais recente em
--   notas_status_sap_aux é sempre tratado como verdade atual,
--   independente de quando foi importado. A próxima importação
--   substitui (upsert por numero_nota_norm).

-- ============================================================
-- 1) vw_notas_sem_ordem — sem janela 48h
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT
  id, numero_nota, tipo_nota, descricao, descricao_objeto,
  prioridade, tipo_prioridade, criado_por_sap, solicitante,
  data_criacao_sap, data_nota, hora_nota, ordem_sap, centro,
  status_sap, conta_fornecedor, autor_nota, streaming_timestamp,
  status, administrador_id, distribuida_em, ordem_gerada,
  fornecedor_encaminhado, observacoes, sync_id, raw_data,
  created_at, updated_at
FROM public.notas_manutencao n
WHERE status = ANY (ARRAY[
    'nova'::nota_status,
    'em_andamento'::nota_status,
    'encaminhada_fornecedor'::nota_status
  ])
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(ltrim(btrim(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.notas_status_sap_aux aux
    WHERE aux.numero_nota_norm
            = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
  );

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Notas abertas genuinamente sem ordem SAP e sem ordem ativa no cockpit. '
  'Fix 00117: exclui notas CANCELADA/VIROU_ORDEM em notas_status_sap_aux. '
  'Fix 00119: removida janela 48h — aux SAP é sempre tratado como verdade atual.';

-- ============================================================
-- 2) distribuir_notas — sem janela 48h
-- ============================================================
CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota          RECORD;
  v_admin         RECORD;
  v_especialidade TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ordens_notas_acompanhamento o
        WHERE o.nota_id = nm.id
           OR (
             o.nota_id IS NULL
             AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
             AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
                 = COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
           )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notas_status_sap_aux aux
        WHERE aux.numero_nota_norm
                = COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
          AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
      )
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY
      CHAR_LENGTH(COALESCE(r.palavra_chave, '')) DESC,
      r.created_at ASC,
      r.id ASC
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    SELECT
      a.id,
      COUNT(DISTINCT n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count,
      CASE
        WHEN v_especialidade = 'geral' THEN
          ROUND(
            COUNT(DISTINCT n.id) FILTER (
              WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
            )
            + COUNT(DISTINCT o.id) FILTER (
              WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
            ) * 0.5
          )::INTEGER
        ELSE
          COUNT(DISTINCT n.id) FILTER (
            WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          )::INTEGER
      END AS score
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.nota_id = n.id
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome, a.max_notas
    HAVING COUNT(DISTINCT n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < COALESCE(a.max_notas, 9999)
    ORDER BY score ASC, a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(DISTINCT n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count,
        ROUND(
          COUNT(DISTINCT n.id) FILTER (
            WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          )
          + COUNT(DISTINCT o.id) FILTER (
            WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
          ) * 0.5
        )::INTEGER AS score
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n
        ON n.administrador_id = a.id
      LEFT JOIN public.ordens_notas_acompanhamento o
        ON o.nota_id = n.id
      WHERE a.role = 'admin'
        AND a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.nome, a.max_notas
      HAVING COUNT(DISTINCT n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      ) < COALESCE(a.max_notas, 9999)
      ORDER BY score ASC, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em   = now(),
      updated_at       = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id          := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas    := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.distribuir_notas(UUID) IS
  'Distribui notas por especialidade via keyword match. '
  'Fix 00117: exclui CANCELADA/VIROU_ORDEM em notas_status_sap_aux. '
  'Fix 00119: removida janela 48h — aux SAP sempre vigente. '
  'Score especialistas = notas_abertas; score geral = notas_abertas + ordens_ativas*0.5. '
  'Fallback para geral; CONTINUE quando sem admin disponível.';

-- ============================================================
-- 3) sincronizar_cockpit_convergencia — sem janela 48h
-- ============================================================
CREATE OR REPLACE FUNCTION public.sincronizar_cockpit_convergencia(
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(inseridas INTEGER, atualizadas INTEGER, total_elegiveis INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridas   INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_elegiveis   INTEGER := 0;
BEGIN
  WITH notas_base AS (
    SELECT
      nm.numero_nota,
      CASE
        WHEN COALESCE(NULLIF(BTRIM(nm.numero_nota), ''), '') = '' THEN '0'
        WHEN BTRIM(nm.numero_nota) ~ '^\d+$'
          THEN COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
        ELSE BTRIM(nm.numero_nota)
      END AS numero_nota_norm,
      nm.id                    AS nota_id,
      nm.ordem_sap,
      nm.status,
      nm.descricao,
      nm.centro,
      nm.administrador_id,
      nm.data_criacao_sap,
      nm.updated_at            AS source_updated_at
    FROM public.notas_manutencao nm
  ),
  source AS (
    SELECT
      nb.numero_nota,
      nb.numero_nota_norm,
      nb.nota_id,
      nb.ordem_sap,
      nb.status,
      nb.descricao,
      nb.centro,
      nb.administrador_id,
      nb.data_criacao_sap,
      nb.source_updated_at,
      aux.status_canonico      AS status_sap_aux,
      aux.importado_em         AS status_sap_aux_importado_em,
      (
        nb.ordem_sap IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.ordens_notas_acompanhamento o
          WHERE o.nota_id = nb.nota_id
            AND o.status_ordem NOT IN ('concluida', 'cancelada')
        )
      )                        AS tem_ordem_vinculada,
      (
        nb.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        AND COALESCE(aux.status_canonico, 'INDEFINIDA') NOT IN ('CANCELADA', 'VIROU_ORDEM')
      )                        AS status_elegivel
    FROM notas_base nb
    LEFT JOIN public.vw_notas_status_sap_aux_latest aux
      ON aux.numero_nota_norm = nb.numero_nota_norm
  ),
  computed AS (
    SELECT
      s.*,
      (s.status_elegivel AND NOT s.tem_ordem_vinculada) AS eligible_cockpit,
      CASE
        WHEN s.tem_ordem_vinculada
          OR s.status_sap_aux = 'VIROU_ORDEM'   THEN 'COM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status = 'cancelada'
          OR s.status_sap_aux = 'CANCELADA'     THEN 'CANCELADA'::public.cockpit_estado_operacional
        WHEN s.status = 'concluida'             THEN 'ENCERRADA_SEM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status_elegivel AND NOT s.tem_ordem_vinculada
                                                THEN 'COCKPIT_PENDENTE'::public.cockpit_estado_operacional
        ELSE                                         'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional
      END AS estado_operacional,
      CASE
        WHEN s.tem_ordem_vinculada              THEN 'ORDEM_ATIVA_VINCULADA'
        WHEN s.status_sap_aux = 'VIROU_ORDEM'   THEN 'SAP_STATUS_VIROU_ORDEM'
        WHEN s.status = 'cancelada'             THEN 'NOTA_CANCELADA'
        WHEN s.status_sap_aux = 'CANCELADA'     THEN 'SAP_STATUS_CANCELADA'
        WHEN s.status = 'concluida'             THEN 'NOTA_CONCLUIDA'
        WHEN NOT s.status_elegivel              THEN 'STATUS_FECHADO'
        ELSE NULL
      END AS reason_not_eligible,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.tem_ordem_vinculada THEN 'ORDEM_ATIVA_VINCULADA' END,
        CASE WHEN s.status_sap_aux = 'VIROU_ORDEM' THEN 'SAP_STATUS_VIROU_ORDEM' END,
        CASE WHEN s.status = 'cancelada' THEN 'NOTA_CANCELADA' END,
        CASE WHEN s.status_sap_aux = 'CANCELADA' THEN 'SAP_STATUS_CANCELADA' END,
        CASE WHEN s.status = 'concluida' THEN 'NOTA_CONCLUIDA' END,
        CASE WHEN NOT s.status_elegivel THEN 'STATUS_FECHADO' END
      ], NULL) AS reason_codes
    FROM source s
  )
  INSERT INTO public.notas_convergencia_cockpit (
    numero_nota, numero_nota_norm, nota_id, ordem_sap, status,
    status_sap_aux, status_sap_aux_importado_em,
    descricao, centro, administrador_id, data_criacao_sap,
    tem_qmel, tem_pmpl, tem_mestre,
    status_elegivel, tem_ordem_vinculada, eligible_cockpit,
    estado_operacional, reason_not_eligible, reason_codes,
    sync_id, source_updated_at
  )
  SELECT
    c.numero_nota, c.numero_nota_norm, c.nota_id, c.ordem_sap, c.status,
    c.status_sap_aux, c.status_sap_aux_importado_em,
    c.descricao, c.centro, c.administrador_id, c.data_criacao_sap,
    true  AS tem_qmel,
    false AS tem_pmpl,
    false AS tem_mestre,
    c.status_elegivel, c.tem_ordem_vinculada, c.eligible_cockpit,
    c.estado_operacional, c.reason_not_eligible, c.reason_codes,
    p_sync_id, c.source_updated_at
  FROM computed c
  ON CONFLICT (numero_nota) DO UPDATE SET
    numero_nota_norm            = EXCLUDED.numero_nota_norm,
    nota_id                     = EXCLUDED.nota_id,
    ordem_sap                   = EXCLUDED.ordem_sap,
    status                      = EXCLUDED.status,
    status_sap_aux              = EXCLUDED.status_sap_aux,
    status_sap_aux_importado_em = EXCLUDED.status_sap_aux_importado_em,
    descricao                   = EXCLUDED.descricao,
    centro                      = EXCLUDED.centro,
    administrador_id            = EXCLUDED.administrador_id,
    data_criacao_sap            = EXCLUDED.data_criacao_sap,
    tem_qmel                    = EXCLUDED.tem_qmel,
    status_elegivel             = EXCLUDED.status_elegivel,
    tem_ordem_vinculada         = EXCLUDED.tem_ordem_vinculada,
    eligible_cockpit            = EXCLUDED.eligible_cockpit,
    estado_operacional          = EXCLUDED.estado_operacional,
    reason_not_eligible         = EXCLUDED.reason_not_eligible,
    reason_codes                = EXCLUDED.reason_codes,
    sync_id                     = EXCLUDED.sync_id,
    source_updated_at           = EXCLUDED.source_updated_at,
    updated_at                  = now()
  WHERE
    notas_convergencia_cockpit.eligible_cockpit       IS DISTINCT FROM EXCLUDED.eligible_cockpit
    OR notas_convergencia_cockpit.status              IS DISTINCT FROM EXCLUDED.status
    OR notas_convergencia_cockpit.status_sap_aux      IS DISTINCT FROM EXCLUDED.status_sap_aux
    OR notas_convergencia_cockpit.status_sap_aux_importado_em IS DISTINCT FROM EXCLUDED.status_sap_aux_importado_em
    OR notas_convergencia_cockpit.administrador_id    IS DISTINCT FROM EXCLUDED.administrador_id
    OR notas_convergencia_cockpit.ordem_sap           IS DISTINCT FROM EXCLUDED.ordem_sap
    OR notas_convergencia_cockpit.tem_ordem_vinculada IS DISTINCT FROM EXCLUDED.tem_ordem_vinculada
    OR notas_convergencia_cockpit.estado_operacional  IS DISTINCT FROM EXCLUDED.estado_operacional
    OR notas_convergencia_cockpit.reason_not_eligible IS DISTINCT FROM EXCLUDED.reason_not_eligible
    OR notas_convergencia_cockpit.reason_codes        IS DISTINCT FROM EXCLUDED.reason_codes;

  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  SELECT COUNT(*) INTO v_elegiveis
  FROM public.notas_convergencia_cockpit
  WHERE eligible_cockpit = true;

  RETURN QUERY SELECT v_inseridas, v_atualizadas, v_elegiveis;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_cockpit_convergencia(UUID) IS
  'Sincroniza notas_manutencao → notas_convergencia_cockpit. '
  'Fix 00119: removida janela 48h do aux SAP — status vigente até próxima importação.';
