-- 00219_mazurkevs_criticos_specialty.sql
--
-- Adiciona Mazurkevs Matos dos Santos como administrador especializado em 'criticos'
-- (alarme de incêndio, extintor, recarga de extintor, mangueira).
-- Antes essas palavras-chave iam para cd_direto (Brenda/Adriano por centro),
-- agora vão direto para Mazurkevs, com pula_cockpit=false (aparecem no cockpit).

-- ============================================================
-- 1. Inserir administrador
-- ============================================================
INSERT INTO public.administradores (
  nome, email, role, especialidade, recebe_distribuicao,
  ativo, em_ferias, meta_semanal, max_notas
)
VALUES (
  'Mazurkevs Matos', 'mazurkevssantos@bemol.com.br',
  'admin', 'criticos', true,
  true, false, 80, 9999
)
ON CONFLICT (email) DO UPDATE SET
  nome                = EXCLUDED.nome,
  role                = EXCLUDED.role,
  especialidade       = EXCLUDED.especialidade,
  recebe_distribuicao = EXCLUDED.recebe_distribuicao,
  ativo               = EXCLUDED.ativo;

-- ============================================================
-- 2. Mapear código SAP
-- ============================================================
INSERT INTO public.sap_user_admin_map (sap_codigo, administrador_id)
SELECT '16321', a.id
FROM public.administradores a
WHERE a.email = 'mazurkevssantos@bemol.com.br'
ON CONFLICT (sap_codigo) DO UPDATE
  SET administrador_id = EXCLUDED.administrador_id;

-- ============================================================
-- 3. Atualizar/inserir regras de distribuição → criticos
-- ============================================================
-- Remove regras antigas de cd_direto para estas keywords
DELETE FROM public.regras_distribuicao
WHERE UPPER(palavra_chave) IN (
  'RECARGA DE EXTINTOR', 'MANGUEIRA',
  'ALARME DE INCENDIO', 'EXTINTOR'
);

-- Insere as novas regras apontando para criticos, visível no cockpit
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('ALARME DE INCENDIO', 'criticos', false),
  ('EXTINTOR',           'criticos', false),
  ('RECARGA DE EXTINTOR','criticos', false),
  ('MANGUEIRA',          'criticos', false)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Atualizar distribuir_notas() para tratar 'criticos' como
--    dono fixo (mesmo tratamento de cd_manaus/cd_taruma)
-- ============================================================
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

    -- Se pula_cockpit (legacy cd_direto), força roteamento por centro
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

    -- Bloco 1: Donos fixos — cd_manaus, cd_taruma, criticos
    -- Sem filtro recebe_distribuicao: proprietários dedicados da especialidade
    IF v_especialidade IN ('cd_manaus', 'cd_taruma', 'criticos') THEN
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

      -- Se dono fixo indisponível (férias), cai no geral
      IF NOT FOUND THEN
        v_especialidade := 'geral';
      END IF;
    END IF;

    -- Bloco 2: Especialidades convencionais (geral, refrigeracao, elevadores)
    -- Fórmula com penalidade relativa à mediana do grupo
    IF NOT FOUND OR v_especialidade NOT IN ('cd_manaus', 'cd_taruma', 'criticos') THEN
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

-- ============================================================
-- 5. Backfill: reatribuir notas abertas com essas keywords
--    que estavam em exclui_cockpit=true (iam para Brenda/Adriano)
-- ============================================================
DO $$
DECLARE
  v_mazurkevs_id UUID;
BEGIN
  SELECT id INTO v_mazurkevs_id
  FROM public.administradores
  WHERE email = 'mazurkevssantos@bemol.com.br';

  IF v_mazurkevs_id IS NULL THEN
    RAISE EXCEPTION 'Mazurkevs não encontrado na tabela administradores';
  END IF;

  -- Reatribui notas abertas com keywords críticas
  UPDATE public.notas_manutencao
  SET administrador_id = v_mazurkevs_id,
      exclui_cockpit   = false,
      updated_at       = now()
  WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND exclui_cockpit = true
    AND (
      UPPER(descricao) LIKE '%ALARME DE INCENDIO%'
      OR UPPER(descricao) LIKE '%EXTINTOR%'
      OR UPPER(descricao) LIKE '%MANGUEIRA%'
    );

  RAISE NOTICE 'Backfill de notas críticas concluído para Mazurkevs (%)', v_mazurkevs_id;
END;
$$;
