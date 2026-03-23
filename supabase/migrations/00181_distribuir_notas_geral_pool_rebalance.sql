-- Migration 00181: Rebalancear fórmula de distribuição do pool geral
--
-- Problema: a fórmula anterior usava ordens_ativas e ordens_7d para estimar carga,
-- o que recompensa ineficiência (quem deixa ordens abertas parece mais ocupado) e
-- pune quem trabalha bem (quem conclui tudo rápido parece vazio e recebe mais).
--
-- Solução: remover ordens_* do pool geral e usar apenas sinais controlados pelo sistema:
--   - notas_7d: histórico semanal
--   - notas_hoje: proteção diária forte (trava quem já recebeu muito hoje)
--   - open_count vs mediana do grupo: penalidade progressiva relativa ao pool
--
-- Escopo: afeta apenas os blocos 2 e 3 (pool geral, refrigeração, elevadores e fallback geral).
-- Pool cd_manaus e cd_taruma: sem alteração (donos fixos, comportamento diferente).

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

    -- Bloco 1: CDs — donos fixos, fórmula com ordens mantida (pool pequeno, comportamento diferente)
    IF v_especialidade IN ('cd_manaus', 'cd_taruma') THEN
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

    -- Bloco 2: Especialidades convencionais (geral, refrigeracao, elevadores)
    -- Nova fórmula: apenas sinais controlados pelo sistema, penalidade relativa à mediana do grupo
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
             AND (n_ab.ordem_sap IS NULL OR TRIM(n_ab.ordem_sap) IN ('', '0', '00000000'))
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
           FROM public.notas_manutencao n_hj
           WHERE n_hj.administrador_id = a.id
             AND n_hj.distribuida_em >= CURRENT_DATE
          ) AS notas_hoje
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
      ),
      mediana AS (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY open_count) AS mediana_abertas
        FROM stats
      )
      SELECT
        s.id,
        s.open_count,
        s.ultima_distribuicao,
        (
          (s.meta_semanal - s.notas_7d)
          - s.notas_hoje * 8
          - GREATEST(0, s.open_count::numeric - m.mediana_abertas) * 3
        ) AS prioridade
      INTO v_admin
      FROM stats s, mediana m
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
      LIMIT 1;

      -- Bloco 3: Fallback para geral se especialista indisponível
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
               AND (n_ab.ordem_sap IS NULL OR TRIM(n_ab.ordem_sap) IN ('', '0', '00000000'))
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
             FROM public.notas_manutencao n_hj
             WHERE n_hj.administrador_id = a.id
               AND n_hj.distribuida_em >= CURRENT_DATE
            ) AS notas_hoje
          FROM public.administradores a
          WHERE a.role = 'admin'
            AND a.ativo = true
            AND a.recebe_distribuicao = true
            AND a.em_ferias = false
            AND a.especialidade = 'geral'
        ),
        mediana AS (
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY open_count) AS mediana_abertas
          FROM stats
        )
        SELECT
          s.id,
          s.open_count,
          s.ultima_distribuicao,
          (
            (s.meta_semanal - s.notas_7d)
            - s.notas_hoje * 8
            - GREATEST(0, s.open_count::numeric - m.mediana_abertas) * 3
          ) AS prioridade
        INTO v_admin
        FROM stats s, mediana m
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
