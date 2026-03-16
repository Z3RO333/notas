-- 00167_ajuste_regras_cd_refrigeracao.sql
--
-- Dois ajustes de roteamento nas regras de distribuição:
--
-- 1) Remove FREEZER e TERMOMETRO DE GELADEIRA da especialidade 'refrigeracao'.
--    Essas notas/ordens passam a cair no fluxo geral (geral ou CD por unidade).
--
-- 2) Modifica distribuir_notas() para adicionar roteamento por centro:
--    Notas de CD MANAUS → cd_manaus (Brenda), CD TARUMA/TURISMO → cd_taruma (Adriano).
--    Para especialidades CD, o filtro recebe_distribuicao NÃO é aplicado
--    (Brenda e Adriano são donos fixos, recebe_distribuicao = false).

-- ============================================================
-- 1) Remove keywords de refrigeração incorretas
-- ============================================================
DELETE FROM public.regras_distribuicao
WHERE UPPER(palavra_chave) IN ('FREEZER', 'TERMOMETRO DE GELADEIRA')
  AND especialidade = 'refrigeracao';

-- ============================================================
-- 2) Recria distribuir_notas com roteamento por centro para CDs
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
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');

    -- Roteamento por centro: se nenhuma especialidade foi detectada por keyword
    -- e a nota pertence a um CD, roteia para o dono fixo correto.
    -- Brenda (cd_manaus) e Adriano (cd_taruma) têm recebe_distribuicao = false,
    -- por isso o lookup deles usa uma query separada sem esse filtro.
    IF v_especialidade = 'geral' THEN
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
      'Distribuição automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
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
  'carga_7d = notas_7d×1.0 + ordens_7d×0.5. '
  'Faixas: ≤10→0, ≤20→8, ≤30→20, 31+→40. '
  'Tiebreaker: ultima_distribuicao ASC NULLS FIRST, nome ASC. '
  'CTE por admin evita produto cartesiano. '
  'Roteamento por centro: CD MANAUS → cd_manaus, CD TARUMA/TURISMO → cd_taruma (sem filtro recebe_distribuicao). '
  'Atualizado em 00167.';
