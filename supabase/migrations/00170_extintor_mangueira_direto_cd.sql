-- 00170_extintor_mangueira_direto_cd.sql
--
-- Notas com RECARGA DE EXTINTOR ou MANGUEIRA na descrição:
--   1. Roteadas diretamente para o dono do CD (Brenda/Adriano) baseado no centro
--   2. Excluídas de notas_convergencia_cockpit (não aparecem no copilot)
--
-- Implementação:
--   A. regras_distribuicao.pula_cockpit  — flag que sinaliza rota direta/sem cockpit
--   B. notas_manutencao.exclui_cockpit   — flag persistente na nota
--   C. Keywords inseridas com especialidade 'cd_direto' e pula_cockpit=true
--   D. distribuir_notas() detecta pula_cockpit e força roteamento por centro
--   E. sincronizar_cockpit_convergencia() filtra exclui_cockpit=true
--   F. Backfill de notas já existentes + limpeza do cockpit

-- ============================================================
-- A. Coluna pula_cockpit em regras_distribuicao
-- ============================================================
ALTER TABLE public.regras_distribuicao
  ADD COLUMN IF NOT EXISTS pula_cockpit BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- B. Coluna exclui_cockpit em notas_manutencao
-- ============================================================
ALTER TABLE public.notas_manutencao
  ADD COLUMN IF NOT EXISTS exclui_cockpit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notas_exclui_cockpit
  ON public.notas_manutencao (exclui_cockpit)
  WHERE exclui_cockpit = true;

-- ============================================================
-- C. Keywords: RECARGA DE EXTINTOR e MANGUEIRA → cd_direto
-- ============================================================
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('RECARGA DE EXTINTOR', 'cd_direto', true),
  ('MANGUEIRA',           'cd_direto', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- D. Recriar distribuir_notas() com suporte a pula_cockpit
-- ============================================================
DROP FUNCTION IF EXISTS public.distribuir_notas(UUID);

CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota          RECORD;
  v_admin         RECORD;
  v_especialidade TEXT;
  v_pula_cockpit  BOOLEAN;
BEGIN
  FOR v_nota IN
    SELECT n.id, n.descricao, n.centro, n.data_criacao_sap, n.created_at
    FROM public.notas_manutencao n
    WHERE n.status = 'nova'
      AND n.administrador_id IS NULL
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND NOT EXISTS (
        SELECT 1
        FROM public.ordens_notas_acompanhamento o
        WHERE o.nota_id = n.id
           OR (
             o.nota_id IS NULL
             AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
             AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
                 = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
           )
      )
    ORDER BY n.data_criacao_sap ASC NULLS LAST, n.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Keyword match: keyword mais longa (mais específica) ganha em empate
    SELECT r.especialidade, r.pula_cockpit
      INTO v_especialidade, v_pula_cockpit
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');
    v_pula_cockpit  := COALESCE(v_pula_cockpit, false);

    -- Se pula_cockpit (ex: EXTINTOR, MANGUEIRA), força roteamento por centro
    -- Especialidade 'cd_direto' → resolve para cd_manaus/cd_taruma/geral
    IF v_especialidade = 'cd_direto' THEN
      IF UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%' THEN
        v_especialidade := 'cd_manaus';
      ELSIF UPPER(COALESCE(v_nota.centro, '')) LIKE '%TARUMA%'
         OR UPPER(COALESCE(v_nota.centro, '')) LIKE '%TURISMO%' THEN
        v_especialidade := 'cd_taruma';
      ELSE
        v_especialidade := 'geral';
      END IF;
    END IF;

    -- Roteamento por centro para geral sem keyword específica
    IF v_especialidade = 'geral' AND NOT v_pula_cockpit THEN
      IF UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%' THEN
        v_especialidade := 'cd_manaus';
      ELSIF UPPER(COALESCE(v_nota.centro, '')) LIKE '%TARUMA%'
         OR UPPER(COALESCE(v_nota.centro, '')) LIKE '%TURISMO%' THEN
        v_especialidade := 'cd_taruma';
      END IF;
    END IF;

    IF v_especialidade IN ('cd_manaus', 'cd_taruma') THEN
      -- Donos fixos de CD: lookup sem filtro recebe_distribuicao
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.notas_manutencao n_ab
           WHERE n_ab.administrador_id = a.id
             AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.ordens_notas_acompanhamento o7
           WHERE o7.administrador_id = a.id
             AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days'
          ) AS ordens_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_oa
           JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
           WHERE n_oa.administrador_id = a.id
             AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')
          ) AS ordens_ativas
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
          -- sem filtro recebe_distribuicao: Brenda e Adriano são donos fixos
      )
      SELECT
        id,
        open_count,
        ultima_distribuicao,
        (
          meta_semanal
          - (notas_7d * 1.0 + ordens_7d * 0.5)
          - CASE
              WHEN open_count <= 10 THEN 0
              WHEN open_count <= 20 THEN 8
              WHEN open_count <= 30 THEN 20
              ELSE 40
            END
          - ordens_ativas * 0.5
        ) AS prioridade
      INTO v_admin
      FROM stats
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
      LIMIT 1;

      -- Se dono de CD indisponível (férias), cai no geral
      IF NOT FOUND THEN
        v_especialidade := 'geral';
      END IF;
    END IF;

    -- Especialidades convencionais (refrigeracao, elevadores, geral)
    IF NOT FOUND OR v_especialidade NOT IN ('cd_manaus', 'cd_taruma') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.notas_manutencao n_ab
           WHERE n_ab.administrador_id = a.id
             AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.ordens_notas_acompanhamento o7
           WHERE o7.administrador_id = a.id
             AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days'
          ) AS ordens_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_oa
           JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
           WHERE n_oa.administrador_id = a.id
             AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')
          ) AS ordens_ativas
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
      )
      SELECT
        id,
        open_count,
        ultima_distribuicao,
        (
          meta_semanal
          - (notas_7d * 1.0 + ordens_7d * 0.5)
          - CASE
              WHEN open_count <= 10 THEN 0
              WHEN open_count <= 20 THEN 8
              WHEN open_count <= 30 THEN 20
              ELSE 40
            END
          - ordens_ativas * 0.5
        ) AS prioridade
      INTO v_admin
      FROM stats
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
      LIMIT 1;

      -- Fallback para geral se especialista indisponível
      IF NOT FOUND AND v_especialidade != 'geral' THEN
        WITH stats AS (
          SELECT
            a.id,
            a.nome,
            a.meta_semanal,
            (SELECT COUNT(*)::INTEGER
             FROM public.notas_manutencao n_ab
             WHERE n_ab.administrador_id = a.id
               AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
            ) AS open_count,
            (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
             FROM public.notas_manutencao n_ld
             WHERE n_ld.administrador_id = a.id
            ) AS ultima_distribuicao,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n7
             WHERE n7.administrador_id = a.id
               AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
            ) AS notas_7d,
            (SELECT COUNT(*)
             FROM public.ordens_notas_acompanhamento o7
             WHERE o7.administrador_id = a.id
               AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days'
            ) AS ordens_7d,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n_oa
             JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
             WHERE n_oa.administrador_id = a.id
               AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')
            ) AS ordens_ativas
          FROM public.administradores a
          WHERE a.role = 'admin'
            AND a.ativo = true
            AND a.recebe_distribuicao = true
            AND a.em_ferias = false
            AND a.especialidade = 'geral'
        )
        SELECT
          id,
          open_count,
          ultima_distribuicao,
          (
            meta_semanal
            - (notas_7d * 1.0 + ordens_7d * 0.5)
            - CASE
                WHEN open_count <= 10 THEN 0
                WHEN open_count <= 20 THEN 8
                WHEN open_count <= 30 THEN 20
                ELSE 40
              END
            - ordens_ativas * 0.5
          ) AS prioridade
        INTO v_admin
        FROM stats
        ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
        LIMIT 1;
      END IF;
    END IF;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.notas_manutencao
    SET administrador_id = v_admin.id,
        distribuida_em   = now(),
        exclui_cockpit   = v_pula_cockpit,
        updated_at       = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log(nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico(nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (' || v_especialidade || CASE WHEN v_pula_cockpit THEN '/pula_cockpit' ELSE '' END || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id          := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas    := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.distribuir_notas(UUID) IS
  'Distribui notas por déficit semanal com penalidade por faixa de backlog. '
  'Prioridade = (meta_semanal - carga_7d) - faixa_penalidade - ordens_ativas×0.5. '
  'Faixas: ≤10→0, ≤20→8, ≤30→20, 31+→40. '
  'Tiebreaker: ultima_distribuicao ASC NULLS FIRST, nome ASC. '
  'CTE por admin evita produto cartesiano. '
  'Roteamento por centro: CD MANAUS → cd_manaus, CD TARUMA/TURISMO → cd_taruma (sem filtro recebe_distribuicao). '
  'Especialidade cd_direto (pula_cockpit=true): EXTINTOR/MANGUEIRA → CD por centro, exclui_cockpit=true na nota. '
  'Atualizado em 00170.';

-- ============================================================
-- E. Recriar sincronizar_cockpit_convergencia() filtrando exclui_cockpit
-- ============================================================
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
    WHERE nm.exclui_cockpit = false   -- notas de rota direta (EXTINTOR, MANGUEIRA) ficam fora
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

-- ============================================================
-- F. Backfill: marcar notas já existentes + limpar cockpit
-- ============================================================

-- Marca notas existentes que contêm EXTINTOR ou MANGUEIRA
UPDATE public.notas_manutencao
SET exclui_cockpit = true,
    updated_at = now()
WHERE exclui_cockpit = false
  AND (
    UPPER(descricao) LIKE '%RECARGA DE EXTINTOR%'
    OR UPPER(descricao) LIKE '%MANGUEIRA%'
  );

-- Remove do cockpit as notas que agora têm exclui_cockpit=true
DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao WHERE exclui_cockpit = true
);
