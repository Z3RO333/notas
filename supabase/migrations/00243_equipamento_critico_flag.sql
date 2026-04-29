-- 00243_equipamento_critico_flag.sql
--
-- Adiciona equipamento_critico TEXT em notas_manutencao.
-- Populado por distribuir_notas() via classificar_equipamento_critico(descricao).
-- NULL = sem equipamento crítico reconhecido.
-- Valor = tipo normalizado: 'ELEVADOR', 'GERADOR', 'MONTA CARGA', 'SUBESTACAO', 'PLATAFORMA'.
-- Refrigeração, AR condicionado etc. NÃO entram nessa flag.

-- ============================================================
-- 1. Coluna
-- ============================================================
ALTER TABLE public.notas_manutencao
  ADD COLUMN IF NOT EXISTS equipamento_critico TEXT;

-- ============================================================
-- 2. Backfill em notas abertas
-- ============================================================
UPDATE public.notas_manutencao
SET equipamento_critico = CASE
    WHEN public.classificar_equipamento_critico(descricao) = ANY(
      ARRAY['ELEVADOR','GERADOR','MONTA CARGA','SUBESTACAO','PLATAFORMA']
    ) THEN public.classificar_equipamento_critico(descricao)
    ELSE NULL
  END
WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  AND equipamento_critico IS NULL;

-- ============================================================
-- 3. View vw_notas_sem_ordem — adicionar coluna
-- ============================================================
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
  denominacao_unidade,
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
  updated_at,
  equipamento_critico
FROM public.notas_manutencao n
WHERE status = ANY (
    ARRAY[
      'nova'::public.nota_status,
      'em_andamento'::public.nota_status,
      'encaminhada_fornecedor'::public.nota_status
    ]
  )
  AND n.exclui_cockpit = false
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

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Painel de notas sem ordem ativa: inclui apenas notas abertas, sem ordem SAP, sem ordem ativa no cockpit e sem status SAP CANCELADA/VIROU_ORDEM.';

ALTER VIEW public.vw_notas_sem_ordem SET (security_invoker = on);

-- ============================================================
-- 4. distribuir_notas() — setar equipamento_critico no UPDATE
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

      IF NOT FOUND THEN
        v_especialidade := 'geral';
      END IF;
    END IF;

    -- Bloco 2: Especialidades convencionais (geral, refrigeracao, elevadores)
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
    SET administrador_id    = v_admin.id,
        distribuida_em      = now(),
        exclui_cockpit      = v_pula_cockpit,
        equipamento_critico = CASE
            WHEN public.classificar_equipamento_critico(v_nota.descricao) = ANY(
              ARRAY['ELEVADOR','GERADOR','MONTA CARGA','SUBESTACAO','PLATAFORMA']
            ) THEN public.classificar_equipamento_critico(v_nota.descricao)
            ELSE NULL
          END,
        updated_at          = now()
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
