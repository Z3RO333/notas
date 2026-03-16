-- 00168_drop_legacy_status_from_main_orders.sql
--
-- Remove a persistencia de status_ordem da tabela principal
-- ordens_notas_acompanhamento.
--
-- Historico continua preservando status_anterior/status_novo por enquanto.
-- A compatibilidade do app fica mantida via status_ordem derivado de
-- status_ordem_raw nas views que ainda expoem o campo legado.

DROP INDEX IF EXISTS public.idx_ordens_notas_acompanhamento_status;
DROP INDEX IF EXISTS public.idx_ordens_notas_status_ativo_nota_id;

CREATE INDEX IF NOT EXISTS idx_ordens_notas_status_ativo_nota_id
  ON public.ordens_notas_acompanhamento (nota_id)
  WHERE nota_id IS NOT NULL
    AND public.status_raw_eh_ativo(status_ordem_raw);

CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
base AS (
  SELECT
    o.id AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome AS administrador_nome,
    CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    public.normalizar_status_ordem(o.status_ordem_raw) AS status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n
    ON n.id = o.nota_id
  LEFT JOIN public.administradores origem
    ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual
    ON atual.id = CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END
  LEFT JOIN public.dim_centro_unidade d
    ON d.centro = o.centro
  LEFT JOIN historico h
    ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NOT NULL
)
SELECT
  b.ordem_id,
  b.nota_id,
  b.numero_nota,
  b.ordem_codigo,
  b.administrador_id,
  b.administrador_nome,
  b.responsavel_atual_id,
  b.responsavel_atual_nome,
  b.centro,
  b.unidade,
  b.status_ordem,
  b.status_ordem_raw,
  b.ordem_detectada_em,
  b.status_atualizado_em,
  b.dias_para_gerar_ordem,
  b.qtd_historico,
  (b.qtd_historico > 0) AS tem_historico,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 0
    ELSE GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 'neutro'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id]
    ) AS x
    WHERE x IS NOT NULL
  ) AS envolvidos_admin_ids,
  b.descricao,
  b.tipo_ordem
FROM base b;

CREATE OR REPLACE VIEW public.vw_ordens_sem_nota_operacional AS
SELECT
  o.id AS ordem_id,
  o.ordem_codigo,
  o.numero_nota,
  o.administrador_id,
  a.nome AS administrador_nome,
  o.centro,
  COALESCE(o.unidade, d.unidade) AS unidade,
  public.normalizar_status_ordem(o.status_ordem_raw) AS status_ordem,
  o.status_ordem_raw,
  o.ordem_detectada_em,
  o.status_atualizado_em,
  'ORDEM_SEM_NOTA'::TEXT AS estado_operacional,
  o.created_at,
  o.updated_at
FROM public.ordens_notas_acompanhamento o
LEFT JOIN public.administradores a
  ON a.id = o.administrador_id
LEFT JOIN public.dim_centro_unidade d
  ON d.centro = o.centro
WHERE o.nota_id IS NULL;

CREATE OR REPLACE FUNCTION public._has_active_order_for_note(
  p_nota_id UUID,
  p_numero_nota TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE public.status_raw_eh_ativo(o.status_ordem_raw)
      AND (
        o.nota_id = p_nota_id
        OR (
          o.nota_id IS NULL
          AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
              = COALESCE(NULLIF(LTRIM(BTRIM(p_numero_nota), '0'), ''), '0')
        )
      )
  );
$function$;

CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT
  id,
  numero_nota,
  tipo_nota,
  descricao,
  descricao_objeto,
  prioridade,
  tipo_prioridade,
  criado_por_sap,
  solicitante,
  data_criacao_sap,
  data_nota,
  hora_nota,
  ordem_sap,
  centro,
  status_sap,
  conta_fornecedor,
  autor_nota,
  streaming_timestamp,
  status,
  administrador_id,
  distribuida_em,
  ordem_gerada,
  fornecedor_encaminhado,
  observacoes,
  sync_id,
  raw_data,
  created_at,
  updated_at
FROM public.notas_manutencao n
WHERE status = ANY (
    ARRAY[
      'nova'::public.nota_status,
      'em_andamento'::public.nota_status,
      'encaminhada_fornecedor'::public.nota_status
    ]
  )
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.notas_status_sap_aux aux
    WHERE aux.numero_nota_norm
      = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
  );

CREATE OR REPLACE FUNCTION public.sync_ordem_admin_from_nota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.administrador_id IS NOT NULL
     AND OLD.administrador_id IS DISTINCT FROM NEW.administrador_id THEN
    UPDATE public.ordens_notas_acompanhamento
    SET
      administrador_id = NEW.administrador_id,
      updated_at = now()
    WHERE nota_id = NEW.id
      AND administrador_id IS NULL
      AND public.status_raw_eh_ativo(status_ordem_raw);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_cockpit_convergencia(
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(inseridas INTEGER, atualizadas INTEGER, total_elegiveis INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_inseridas INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_elegiveis INTEGER := 0;
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
      nm.id AS nota_id,
      nm.ordem_sap,
      nm.status,
      nm.descricao,
      nm.centro,
      nm.administrador_id,
      nm.data_criacao_sap,
      nm.updated_at AS source_updated_at
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
      aux.status_canonico AS status_sap_aux,
      aux.importado_em AS status_sap_aux_importado_em,
      (
        nb.ordem_sap IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.ordens_notas_acompanhamento o
          WHERE o.nota_id = nb.nota_id
            AND public.status_raw_eh_ativo(o.status_ordem_raw)
        )
      ) AS tem_ordem_vinculada,
      (
        nb.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        AND COALESCE(aux.status_canonico, 'INDEFINIDA') NOT IN ('CANCELADA', 'VIROU_ORDEM')
      ) AS status_elegivel
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
          OR s.status_sap_aux = 'VIROU_ORDEM' THEN 'COM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status = 'cancelada'
          OR s.status_sap_aux = 'CANCELADA' THEN 'CANCELADA'::public.cockpit_estado_operacional
        WHEN s.status = 'concluida' THEN 'ENCERRADA_SEM_ORDEM'::public.cockpit_estado_operacional
        WHEN s.status_elegivel AND NOT s.tem_ordem_vinculada
          THEN 'COCKPIT_PENDENTE'::public.cockpit_estado_operacional
        ELSE 'AGUARDANDO_CONVERGENCIA'::public.cockpit_estado_operacional
      END AS estado_operacional,
      CASE
        WHEN s.tem_ordem_vinculada THEN 'ORDEM_ATIVA_VINCULADA'
        WHEN s.status_sap_aux = 'VIROU_ORDEM' THEN 'SAP_STATUS_VIROU_ORDEM'
        WHEN s.status = 'cancelada' THEN 'NOTA_CANCELADA'
        WHEN s.status_sap_aux = 'CANCELADA' THEN 'SAP_STATUS_CANCELADA'
        WHEN s.status = 'concluida' THEN 'NOTA_CONCLUIDA'
        WHEN NOT s.status_elegivel THEN 'STATUS_FECHADO'
        ELSE NULL
      END AS reason_not_eligible,
      ARRAY_REMOVE(
        ARRAY[
          CASE WHEN s.tem_ordem_vinculada THEN 'ORDEM_ATIVA_VINCULADA' END,
          CASE WHEN s.status_sap_aux = 'VIROU_ORDEM' THEN 'SAP_STATUS_VIROU_ORDEM' END,
          CASE WHEN s.status = 'cancelada' THEN 'NOTA_CANCELADA' END,
          CASE WHEN s.status_sap_aux = 'CANCELADA' THEN 'SAP_STATUS_CANCELADA' END,
          CASE WHEN s.status = 'concluida' THEN 'NOTA_CONCLUIDA' END,
          CASE WHEN NOT s.status_elegivel THEN 'STATUS_FECHADO' END
        ],
        NULL
      ) AS reason_codes
    FROM source s
  )
  INSERT INTO public.notas_convergencia_cockpit (
    numero_nota,
    numero_nota_norm,
    nota_id,
    ordem_sap,
    status,
    status_sap_aux,
    status_sap_aux_importado_em,
    descricao,
    centro,
    administrador_id,
    data_criacao_sap,
    tem_qmel,
    tem_pmpl,
    tem_mestre,
    status_elegivel,
    tem_ordem_vinculada,
    eligible_cockpit,
    estado_operacional,
    reason_not_eligible,
    reason_codes,
    sync_id,
    source_updated_at
  )
  SELECT
    c.numero_nota,
    c.numero_nota_norm,
    c.nota_id,
    c.ordem_sap,
    c.status,
    c.status_sap_aux,
    c.status_sap_aux_importado_em,
    c.descricao,
    c.centro,
    c.administrador_id,
    c.data_criacao_sap,
    true,
    false,
    false,
    c.status_elegivel,
    c.tem_ordem_vinculada,
    c.eligible_cockpit,
    c.estado_operacional,
    c.reason_not_eligible,
    c.reason_codes,
    p_sync_id,
    c.source_updated_at
  FROM computed c
  ON CONFLICT (numero_nota) DO UPDATE SET
    numero_nota_norm = EXCLUDED.numero_nota_norm,
    nota_id = EXCLUDED.nota_id,
    ordem_sap = EXCLUDED.ordem_sap,
    status = EXCLUDED.status,
    status_sap_aux = EXCLUDED.status_sap_aux,
    status_sap_aux_importado_em = EXCLUDED.status_sap_aux_importado_em,
    descricao = EXCLUDED.descricao,
    centro = EXCLUDED.centro,
    administrador_id = EXCLUDED.administrador_id,
    data_criacao_sap = EXCLUDED.data_criacao_sap,
    tem_qmel = EXCLUDED.tem_qmel,
    status_elegivel = EXCLUDED.status_elegivel,
    tem_ordem_vinculada = EXCLUDED.tem_ordem_vinculada,
    eligible_cockpit = EXCLUDED.eligible_cockpit,
    estado_operacional = EXCLUDED.estado_operacional,
    reason_not_eligible = EXCLUDED.reason_not_eligible,
    reason_codes = EXCLUDED.reason_codes,
    sync_id = EXCLUDED.sync_id,
    source_updated_at = EXCLUDED.source_updated_at,
    updated_at = now()
  WHERE
    notas_convergencia_cockpit.eligible_cockpit IS DISTINCT FROM EXCLUDED.eligible_cockpit
    OR notas_convergencia_cockpit.status IS DISTINCT FROM EXCLUDED.status
    OR notas_convergencia_cockpit.status_sap_aux IS DISTINCT FROM EXCLUDED.status_sap_aux
    OR notas_convergencia_cockpit.status_sap_aux_importado_em IS DISTINCT FROM EXCLUDED.status_sap_aux_importado_em
    OR notas_convergencia_cockpit.administrador_id IS DISTINCT FROM EXCLUDED.administrador_id
    OR notas_convergencia_cockpit.ordem_sap IS DISTINCT FROM EXCLUDED.ordem_sap
    OR notas_convergencia_cockpit.tem_ordem_vinculada IS DISTINCT FROM EXCLUDED.tem_ordem_vinculada
    OR notas_convergencia_cockpit.estado_operacional IS DISTINCT FROM EXCLUDED.estado_operacional
    OR notas_convergencia_cockpit.reason_not_eligible IS DISTINCT FROM EXCLUDED.reason_not_eligible
    OR notas_convergencia_cockpit.reason_codes IS DISTINCT FROM EXCLUDED.reason_codes;

  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  SELECT COUNT(*) INTO v_elegiveis
  FROM public.notas_convergencia_cockpit
  WHERE eligible_cockpit = true;

  RETURN QUERY
  SELECT v_inseridas, v_atualizadas, v_elegiveis;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliar_notas_em_geracao(
  p_sync_id UUID DEFAULT NULL,
  p_ttl_minutes INTEGER DEFAULT 60,
  p_confirm_repair_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
      WHERE public.status_raw_eh_ativo(o.status_ordem_raw)
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
$function$;

CREATE OR REPLACE FUNCTION public.atribuir_responsavel_ordens_standalone()
RETURNS TABLE(
  total_candidatas INTEGER,
  responsaveis_preenchidos INTEGER,
  atribuicoes_criado_por INTEGER,
  atribuicoes_refrigeracao INTEGER,
  atribuicoes_pmpl_config INTEGER,
  atribuicoes_cd_fixo INTEGER,
  atribuicoes_fallback INTEGER,
  sem_destino INTEGER,
  regras_refrigeracao_encontradas INTEGER,
  admins_refrigeracao_elegiveis INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ordem RECORD;
  v_destino UUID;
  v_categoria TEXT;
  v_esp_match TEXT;
  v_pmpl_resp_id UUID;
  v_pmpl_sub_id UUID;
  v_total INTEGER := 0;
  v_preenchidos INTEGER := 0;
  v_criado_por_cnt INTEGER := 0;
  v_refrigeracao_cnt INTEGER := 0;
  v_pmpl_config_cnt INTEGER := 0;
  v_cd_fixo_cnt INTEGER := 0;
  v_fallback_cnt INTEGER := 0;
  v_sem_destino_cnt INTEGER := 0;
  v_regras_refrig INTEGER := 0;
  v_admins_refrig INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO v_regras_refrig
  FROM public.regras_distribuicao
  WHERE especialidade = 'refrigeracao';

  SELECT COUNT(*) INTO v_admins_refrig
  FROM public.administradores a
  WHERE a.especialidade = 'refrigeracao'
    AND a.ativo = true
    AND a.recebe_distribuicao = true
    AND a.em_ferias = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    );

  SELECT r.responsavel_id, r.substituto_id
  INTO v_pmpl_resp_id, v_pmpl_sub_id
  FROM public.responsaveis_tipo_ordem r
  WHERE r.tipo_ordem = 'PMPL'
  LIMIT 1;

  FOR v_ordem IN
    SELECT
      o.id,
      o.ordem_codigo,
      o.centro,
      o.criado_por,
      COALESCE(o.tipo_ordem, ref.tipo_ordem) AS tipo_ordem_efetivo,
      ref.texto_breve,
      COALESCE(o.unidade, d.unidade) AS unidade_efetiva
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    LEFT JOIN public.dim_centro_unidade d
      ON d.centro = o.centro
    WHERE o.nota_id IS NULL
      AND o.administrador_id IS NULL
  LOOP
    v_total := v_total + 1;
    v_destino := NULL;
    v_categoria := NULL;

    IF v_ordem.criado_por IS NOT NULL
       AND v_ordem.tipo_ordem_efetivo IS DISTINCT FROM 'PMPL' THEN
      v_destino := v_ordem.criado_por;
      v_categoria := 'criado_por';
    END IF;

    IF v_destino IS NULL THEN
      SELECT r.especialidade
      INTO v_esp_match
      FROM public.regras_distribuicao r
      WHERE r.especialidade = 'refrigeracao'
        AND COALESCE(v_ordem.texto_breve, '') ILIKE '%' || r.palavra_chave || '%'
      LIMIT 1;

      IF v_esp_match IS NOT NULL THEN
        SELECT a.id
        INTO v_destino
        FROM public.administradores a
        LEFT JOIN public.ordens_notas_acompanhamento oo
          ON oo.administrador_id = a.id
         AND public.status_raw_eh_ativo(oo.status_ordem_raw)
        WHERE a.especialidade = 'refrigeracao'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          )
        GROUP BY a.id
        ORDER BY COUNT(oo.id) ASC, a.nome ASC
        LIMIT 1;

        IF v_destino IS NOT NULL THEN
          v_categoria := 'refrigeracao';
        ELSE
          SELECT a.id
          INTO v_destino
          FROM public.administradores a
          WHERE a.role = 'gestor'
            AND LOWER(a.email) IN (
              'walterrodrigues@bemol.com.br',
              'danieldamasceno@bemol.com.br'
            )
            AND a.ativo = true
            AND a.em_ferias = false
            AND (
              a.data_inicio_ferias IS NULL
              OR a.data_fim_ferias IS NULL
              OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
            )
          ORDER BY a.nome ASC
          LIMIT 1;

          IF v_destino IS NOT NULL THEN
            v_categoria := 'refrigeracao';
          ELSE
            v_destino := public.pick_fallback_admin_for_order(v_ordem.centro);
            v_categoria := 'fallback';
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_destino IS NULL AND v_ordem.tipo_ordem_efetivo = 'PMPL' THEN
      IF v_pmpl_resp_id IS NOT NULL THEN
        SELECT a.id
        INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_resp_id
          AND a.ativo = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          );
      END IF;

      IF v_destino IS NULL AND v_pmpl_sub_id IS NOT NULL THEN
        SELECT a.id
        INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_sub_id
          AND a.ativo = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          );
      END IF;

      IF v_destino IS NOT NULL THEN
        v_categoria := 'pmpl_config';
      ELSE
        v_destino := public.pick_fallback_admin_for_order(v_ordem.centro);
        v_categoria := 'fallback';
      END IF;
    END IF;

    IF v_destino IS NULL AND v_ordem.unidade_efetiva IS NOT NULL THEN
      SELECT a.id
      INTO v_destino
      FROM public.administradores a
      WHERE a.ativo = true
        AND a.em_ferias = false
        AND (
          a.data_inicio_ferias IS NULL
          OR a.data_fim_ferias IS NULL
          OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
        )
        AND (
          (
            a.especialidade = 'cd_taruma'
            AND (
              v_ordem.unidade_efetiva ILIKE '%TURISMO%'
              OR v_ordem.unidade_efetiva ILIKE '%TARUMA%'
            )
          )
          OR (
            a.especialidade = 'cd_manaus'
            AND v_ordem.unidade_efetiva ILIKE '%MANAUS%'
          )
        )
      ORDER BY a.nome ASC
      LIMIT 1;

      IF v_destino IS NOT NULL THEN
        v_categoria := 'cd_fixo';
      END IF;
    END IF;

    IF v_destino IS NULL THEN
      v_destino := public.pick_fallback_admin_for_order(v_ordem.centro);
      v_categoria := 'fallback';
    END IF;

    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET
        administrador_id = v_destino,
        updated_at = now()
      WHERE id = v_ordem.id;

      v_preenchidos := v_preenchidos + 1;

      IF v_categoria = 'criado_por' THEN
        v_criado_por_cnt := v_criado_por_cnt + 1;
      ELSIF v_categoria = 'refrigeracao' THEN
        v_refrigeracao_cnt := v_refrigeracao_cnt + 1;
      ELSIF v_categoria = 'pmpl_config' THEN
        v_pmpl_config_cnt := v_pmpl_config_cnt + 1;
      ELSIF v_categoria = 'cd_fixo' THEN
        v_cd_fixo_cnt := v_cd_fixo_cnt + 1;
      ELSE
        v_fallback_cnt := v_fallback_cnt + 1;
      END IF;
    ELSE
      v_sem_destino_cnt := v_sem_destino_cnt + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    v_total,
    v_preenchidos,
    v_criado_por_cnt,
    v_refrigeracao_cnt,
    v_pmpl_config_cnt,
    v_cd_fixo_cnt,
    v_fallback_cnt,
    v_sem_destino_cnt,
    v_regras_refrig,
    v_admins_refrig;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id UUID)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por UUID;
  v_detectadas INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
BEGIN
  FOR v_nota IN
    SELECT
      n.id,
      n.numero_nota,
      n.administrador_id,
      n.centro,
      n.status,
      n.data_criacao_sap,
      n.created_at,
      n.ordem_sap,
      n.ordem_gerada,
      n.criado_por_sap,
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

    SELECT d.unidade
    INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro, '');

    SELECT m.administrador_id
    INTO v_criado_por
    FROM public.sap_user_admin_map m
    WHERE m.sap_codigo = v_nota.criado_por_sap;

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (CURRENT_DATE - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
        0
      );

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id,
        numero_nota,
        ordem_codigo,
        administrador_id,
        criado_por,
        centro,
        unidade,
        status_ordem_raw,
        ordem_detectada_em,
        status_atualizado_em,
        dias_para_gerar_ordem,
        sync_id
      )
      VALUES (
        v_nota.id,
        v_nota.numero_nota,
        v_ordem_codigo,
        v_nota.administrador_id,
        v_criado_por,
        v_nota.centro,
        v_unidade,
        'ABERTO',
        now(),
        now(),
        v_dias_para_gerar,
        p_sync_id
      )
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        NULL,
        'aberta',
        'ABERTO',
        'detectada_na_nota',
        p_sync_id
      );

      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento
      SET
        nota_id = v_nota.id,
        numero_nota = v_nota.numero_nota,
        administrador_id = COALESCE(v_nota.administrador_id, ordens_notas_acompanhamento.administrador_id),
        criado_por = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
        centro = COALESCE(v_nota.centro, ordens_notas_acompanhamento.centro),
        unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
        sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
        updated_at = now()
      WHERE id = v_ordem.id;
    END IF;

    UPDATE public.notas_manutencao
    SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
      updated_at = now()
    WHERE id = v_nota.id
      AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

    IF v_nota.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao
      SET
        status = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
        updated_at = now()
      WHERE id = v_nota.id;

      INSERT INTO public.notas_historico (
        nota_id,
        campo_alterado,
        valor_anterior,
        valor_novo,
        motivo
      )
      VALUES (
        v_nota.id,
        'status',
        v_nota.status::TEXT,
        'concluida',
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_detectadas, v_auto_concluidas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_item JSONB;
  v_ordem_codigo TEXT;
  v_status_raw TEXT;
  v_centro TEXT;
  v_unidade TEXT;
  v_denominacao_unidade TEXT;
  v_data_raw TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem TEXT;
  v_criado_por_sap TEXT;
  v_fornecedor_codigo TEXT;
  v_fornecedor_nome TEXT;
  v_texto_breve TEXT;
  v_exists BOOLEAN;
  v_total INTEGER := 0;
  v_inseridas INTEGER := 0;
  v_atualizadas INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_denominacao_unidade := NULLIF(BTRIM(v_item ->> 'denominacao_unidade'), '');
    v_tipo_ordem := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_criado_por_sap := NULLIF(BTRIM(v_item ->> 'criado_por_sap_codigo'), '');
    v_fornecedor_codigo := NULLIF(BTRIM(v_item ->> 'fornecedor_codigo'), '');
    v_texto_breve := NULLIF(BTRIM(v_item ->> 'texto_breve'), '');

    v_fornecedor_nome := NULL;
    IF v_fornecedor_codigo IS NOT NULL THEN
      SELECT d.nome
      INTO v_fornecedor_nome
      FROM public.dim_operacionais d
      WHERE d.codigo = v_fornecedor_codigo;
    END IF;

    v_data_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade
      INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.ordens_notas_acompanhamento
      WHERE ordem_codigo = v_ordem_codigo
    ) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      ordem_codigo,
      status_ordem_raw,
      centro,
      unidade,
      denominacao_unidade,
      data_entrada,
      tipo_ordem,
      criado_por_sap_codigo,
      fornecedor_codigo,
      fornecedor_nome,
      texto_breve,
      sync_id,
      ordem_detectada_em
    )
    VALUES (
      NULL,
      v_ordem_codigo,
      v_status_raw,
      v_centro,
      v_unidade,
      v_denominacao_unidade,
      v_data_entrada,
      v_tipo_ordem,
      v_criado_por_sap,
      v_fornecedor_codigo,
      v_fornecedor_nome,
      v_texto_breve,
      p_sync_id,
      COALESCE(v_data_entrada, now())
    )
    ON CONFLICT (ordem_codigo) DO UPDATE
    SET
      status_ordem_raw = COALESCE(EXCLUDED.status_ordem_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(EXCLUDED.centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(EXCLUDED.unidade, ordens_notas_acompanhamento.unidade),
      denominacao_unidade = COALESCE(EXCLUDED.denominacao_unidade, ordens_notas_acompanhamento.denominacao_unidade),
      data_entrada = CASE
        WHEN EXCLUDED.data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem = COALESCE(EXCLUDED.tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      criado_por_sap_codigo = COALESCE(EXCLUDED.criado_por_sap_codigo, ordens_notas_acompanhamento.criado_por_sap_codigo),
      fornecedor_codigo = COALESCE(EXCLUDED.fornecedor_codigo, ordens_notas_acompanhamento.fornecedor_codigo),
      fornecedor_nome = COALESCE(EXCLUDED.fornecedor_nome, ordens_notas_acompanhamento.fornecedor_nome),
      texto_breve = COALESCE(EXCLUDED.texto_breve, ordens_notas_acompanhamento.texto_breve),
      status_atualizado_em = now(),
      sync_id = COALESCE(EXCLUDED.sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now();

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_total, v_inseridas, v_atualizadas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_status_ordens_pmpl_lote(
  p_updates JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, ordens_atualizadas INTEGER, mudancas_status INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item JSONB;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_status_raw TEXT;
  v_status_novo public.ordem_status_acomp;
  v_status_anterior public.ordem_status_acomp;
  v_centro TEXT;
  v_unidade TEXT;
  v_data_entrada_raw TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem TEXT;
  v_total INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_mudancas INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');

    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_data_entrada_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    v_tipo_ordem := NULLIF(BTRIM(v_item ->> 'tipo_ordem'), '');

    IF v_data_entrada_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_entrada_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_status_anterior := public.normalizar_status_ordem(v_ordem.status_ordem_raw);
    v_status_novo := CASE
      WHEN v_status_raw IS NULL THEN v_status_anterior
      ELSE public.normalizar_status_ordem(v_status_raw)
    END;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade
      INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET
      status_ordem_raw = COALESCE(v_status_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(v_centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
      data_entrada = CASE
        WHEN v_data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN v_data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, v_data_entrada)
      END,
      tipo_ordem = COALESCE(v_tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now()
    WHERE id = v_ordem.id;

    v_atualizadas := v_atualizadas + 1;

    IF v_status_raw IS NOT NULL
       AND v_status_anterior IS DISTINCT FROM v_status_novo THEN
      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        v_status_anterior,
        v_status_novo,
        v_status_raw,
        'pmpl_sync',
        p_sync_id
      );

      v_mudancas := v_mudancas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_total, v_atualizadas, v_mudancas;
END;
$function$;

CREATE OR REPLACE VIEW public.vw_carga_real_administradores AS
WITH ordens_ativas_ids AS (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE public.status_raw_eh_ativo(status_ordem_raw)
    AND nota_id IS NOT NULL
),
notas_abertas_agg AS (
  SELECT
    n.administrador_id,
    COUNT(*) FILTER (WHERE n.status = 'nova') AS qtd_nova,
    COUNT(*) FILTER (WHERE n.status = 'em_andamento') AS qtd_em_andamento,
    COUNT(*) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
    COUNT(*) AS qtd_abertas
  FROM public.notas_manutencao n
  LEFT JOIN ordens_ativas_ids oa
    ON oa.nota_id = n.id
  LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
    ON sap_aux.numero_nota_norm
      = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
  WHERE n.administrador_id IS NOT NULL
    AND n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
    AND oa.nota_id IS NULL
    AND (
      sap_aux.status_canonico IS NULL
      OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM')
    )
  GROUP BY n.administrador_id
),
notas_concluidas_agg AS (
  SELECT administrador_id, COUNT(*) AS qtd_concluidas
  FROM public.notas_manutencao
  WHERE status = 'concluida'
    AND administrador_id IS NOT NULL
  GROUP BY administrador_id
),
ordens_ativas_agg AS (
  SELECT administrador_id, COUNT(*) AS qtd_ordens_ativas
  FROM public.ordens_notas_acompanhamento
  WHERE public.status_raw_eh_ativo(status_ordem_raw)
    AND administrador_id IS NOT NULL
  GROUP BY administrador_id
),
notas_7d_agg AS (
  SELECT administrador_id, COUNT(*) AS notas_recebidas_7d
  FROM public.notas_manutencao
  WHERE administrador_id IS NOT NULL
    AND distribuida_em >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
),
ordens_7d_agg AS (
  SELECT administrador_id, COUNT(*) AS ordens_recebidas_7d
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id IS NOT NULL
    AND ordem_detectada_em >= NOW() - INTERVAL '7 days'
  GROUP BY administrador_id
)
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  a.recebe_distribuicao,
  a.em_ferias,
  a.data_inicio_ferias,
  a.data_fim_ferias,
  a.motivo_bloqueio,
  COALESCE(na.qtd_nova, 0)::INTEGER AS qtd_nova,
  COALESCE(na.qtd_em_andamento, 0)::INTEGER AS qtd_em_andamento,
  COALESCE(na.qtd_encaminhada, 0)::INTEGER AS qtd_encaminhada,
  COALESCE(na.qtd_abertas, 0)::INTEGER AS qtd_abertas,
  COALESCE(nc.qtd_concluidas, 0)::INTEGER AS qtd_concluidas,
  COALESCE(oa.qtd_ordens_ativas, 0)::INTEGER AS qtd_ordens_ativas,
  CASE
    WHEN a.especialidade = 'geral' THEN
      ROUND(
        COALESCE(na.qtd_abertas, 0)
        + COALESCE(oa.qtd_ordens_ativas, 0) * 0.5
      )::INTEGER
    ELSE
      COALESCE(na.qtd_abertas, 0)::INTEGER
  END AS score_carga,
  a.meta_semanal,
  COALESCE(n7.notas_recebidas_7d, 0)::INTEGER AS notas_recebidas_7d,
  COALESCE(o7.ordens_recebidas_7d, 0)::INTEGER AS ordens_recebidas_7d
FROM public.administradores a
LEFT JOIN notas_abertas_agg na
  ON na.administrador_id = a.id
LEFT JOIN notas_concluidas_agg nc
  ON nc.administrador_id = a.id
LEFT JOIN ordens_ativas_agg oa
  ON oa.administrador_id = a.id
LEFT JOIN notas_7d_agg n7
  ON n7.administrador_id = a.id
LEFT JOIN ordens_7d_agg o7
  ON o7.administrador_id = a.id
WHERE a.role = 'admin';

CREATE OR REPLACE VIEW public.vw_iso_por_admin AS
WITH ordens_ativas_ids AS (
  SELECT DISTINCT nota_id
  FROM public.ordens_notas_acompanhamento
  WHERE public.status_raw_eh_ativo(status_ordem_raw)
    AND nota_id IS NOT NULL
),
admin_base AS (
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade,
    a.max_notas,
    a.ativo,
    a.recebe_distribuicao,
    a.em_ferias,
    COALESCE(c.qtd_abertas, 0)::INT AS qtd_abertas
  FROM public.administradores a
  LEFT JOIN public.vw_carga_real_administradores c
    ON c.id = a.id
  WHERE a.role = 'admin'
),
nota_aging AS (
  SELECT
    n.administrador_id,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 4 THEN 100
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 3 THEN 80
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 2 THEN 60
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 1 THEN 30
      ELSE 0
    END AS peso,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - COALESCE(n.data_criacao_sap::TIMESTAMP, n.created_at)) >= 5 THEN 1
      ELSE 0
    END AS is_critico
  FROM public.notas_manutencao n
  LEFT JOIN ordens_ativas_ids oa
    ON oa.nota_id = n.id
  LEFT JOIN public.vw_notas_status_sap_aux_latest sap_aux
    ON sap_aux.numero_nota_norm
      = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND n.administrador_id IS NOT NULL
    AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
    AND oa.nota_id IS NULL
    AND (
      sap_aux.status_canonico IS NULL
      OR sap_aux.status_canonico NOT IN ('CANCELADA', 'VIROU_ORDEM')
    )
),
nota_agg AS (
  SELECT
    administrador_id,
    COALESCE(AVG(peso), 0) AS nota_severity,
    COALESCE(SUM(is_critico), 0)::INT AS qtd_notas_criticas
  FROM nota_aging
  GROUP BY administrador_id
),
ordem_agg AS (
  SELECT
    o.administrador_id,
    COUNT(*) FILTER (WHERE o.semaforo_atraso = 'vermelho') AS qtd_vermelhas,
    COUNT(*) AS qtd_total
  FROM public.vw_ordens_notas_painel o
  WHERE o.administrador_id IS NOT NULL
    AND public.status_raw_eh_ativo(o.status_ordem_raw)
  GROUP BY o.administrador_id
)
SELECT
  ab.administrador_id,
  ab.nome,
  ab.avatar_url,
  ab.especialidade,
  ROUND(COALESCE(na.nota_severity, 0)::NUMERIC, 1) AS nota_severity,
  ROUND(
    CASE
      WHEN COALESCE(oa.qtd_total, 0) > 0
        THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100
      ELSE 0
    END,
    1
  ) AS order_severity,
  ROUND(
    LEAST(
      CASE
        WHEN ab.max_notas > 0
          THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
        ELSE 0
      END,
      100
    ),
    1
  ) AS workload_pressure,
  ROUND(
    CASE
      WHEN ab.qtd_abertas > 0
        THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100
      ELSE 0
    END,
    1
  ) AS critical_density,
  ROUND(
    (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE
          WHEN COALESCE(oa.qtd_total, 0) > 0
            THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE
            WHEN ab.max_notas > 0
              THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE
          WHEN ab.qtd_abertas > 0
            THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    )::NUMERIC,
    1
  ) AS iso_score,
  CASE
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE
          WHEN COALESCE(oa.qtd_total, 0) > 0
            THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE
            WHEN ab.max_notas > 0
              THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE
          WHEN ab.qtd_abertas > 0
            THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 75 THEN 'critico'
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE
          WHEN COALESCE(oa.qtd_total, 0) > 0
            THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE
            WHEN ab.max_notas > 0
              THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE
          WHEN ab.qtd_abertas > 0
            THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 50 THEN 'risco_alto'
    WHEN (
      COALESCE(na.nota_severity, 0) * 0.25
      + CASE
          WHEN COALESCE(oa.qtd_total, 0) > 0
            THEN (COALESCE(oa.qtd_vermelhas, 0)::NUMERIC / oa.qtd_total) * 100 * 0.25
          ELSE 0
        END
      + LEAST(
          CASE
            WHEN ab.max_notas > 0
              THEN (ab.qtd_abertas::NUMERIC / ab.max_notas) * 100
            ELSE 0
          END,
          100
        ) * 0.25
      + CASE
          WHEN ab.qtd_abertas > 0
            THEN (COALESCE(na.qtd_notas_criticas, 0)::NUMERIC / ab.qtd_abertas) * 100 * 0.25
          ELSE 0
        END
    ) >= 25 THEN 'atencao'
    ELSE 'saudavel'
  END AS iso_faixa,
  ab.qtd_abertas,
  ab.max_notas,
  COALESCE(na.qtd_notas_criticas, 0)::INT AS qtd_notas_criticas,
  COALESCE(oa.qtd_vermelhas, 0)::INT AS qtd_ordens_vermelhas
FROM admin_base ab
LEFT JOIN nota_agg na
  ON na.administrador_id = ab.administrador_id
LEFT JOIN ordem_agg oa
  ON oa.administrador_id = ab.administrador_id
WHERE ab.qtd_abertas > 0 OR ab.recebe_distribuicao OR ab.em_ferias
ORDER BY iso_score DESC;

ALTER TABLE public.ordens_notas_acompanhamento
  DROP COLUMN IF EXISTS status_ordem;
