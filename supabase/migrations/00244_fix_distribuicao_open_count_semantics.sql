-- 00244_fix_distribuicao_open_count_semantics.sql
--
-- Alinha a carga usada por distribuir_notas() com a view canonica do
-- painel de notas. A funcao antiga contava notas brutas com status do
-- cockpit em aberto mesmo quando o SAP aux ja marcava CANCELADA/VIROU_ORDEM,
-- o que penalizava admins com notas que nao apareciam mais na tela.

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
    SELECT n.id, n.numero_nota, n.descricao, n.centro, n.data_criacao_sap, n.created_at
    FROM public.notas_manutencao n
    WHERE n.status = 'nova'
      AND n.administrador_id IS NULL
      AND COALESCE(n.exclui_cockpit, false) = false
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.notas_status_sap_aux aux
        WHERE aux.numero_nota_norm
          = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
          AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
      )
    ORDER BY n.data_criacao_sap ASC NULLS LAST, n.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade, r.pula_cockpit
      INTO v_especialidade, v_pula_cockpit
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');
    v_pula_cockpit  := COALESCE(v_pula_cockpit, false);

    IF v_especialidade = 'excluir' THEN
      UPDATE public.notas_manutencao
      SET exclui_cockpit = true,
          updated_at = now()
      WHERE id = v_nota.id;

      CONTINUE;
    END IF;

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

    IF v_especialidade = 'geral' AND NOT v_pula_cockpit THEN
      IF UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%' THEN
        v_especialidade := 'cd_manaus';
      ELSIF UPPER(COALESCE(v_nota.centro, '')) LIKE '%TARUMA%'
         OR UPPER(COALESCE(v_nota.centro, '')) LIKE '%TURISMO%' THEN
        v_especialidade := 'cd_taruma';
      END IF;
    END IF;

    IF v_especialidade IN ('cd_manaus', 'cd_taruma', 'criticos') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.vw_notas_sem_ordem v
           WHERE v.administrador_id = a.id
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
             AND COALESCE(n_ld.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_ld
               WHERE aux_ld.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                 AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
             AND COALESCE(n7.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux7
               WHERE aux7.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                 AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
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

    IF NOT FOUND OR v_especialidade NOT IN ('cd_manaus', 'cd_taruma', 'criticos') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.vw_notas_sem_ordem v
           WHERE v.administrador_id = a.id
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
             AND COALESCE(n_ld.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_ld
               WHERE aux_ld.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                 AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
             AND COALESCE(n7.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux7
               WHERE aux7.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                 AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_hj
           WHERE n_hj.administrador_id = a.id
             AND n_hj.distribuida_em >= CURRENT_DATE
             AND COALESCE(n_hj.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_hj
               WHERE aux_hj.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_hj.numero_nota), '0'), ''), '0')
                 AND aux_hj.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
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

      IF NOT FOUND AND v_especialidade != 'geral' THEN
        WITH stats AS (
          SELECT
            a.id,
            a.nome,
            a.meta_semanal,
            (SELECT COUNT(*)::INTEGER
             FROM public.vw_notas_sem_ordem v
             WHERE v.administrador_id = a.id
            ) AS open_count,
            (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
             FROM public.notas_manutencao n_ld
             WHERE n_ld.administrador_id = a.id
               AND COALESCE(n_ld.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux_ld
                 WHERE aux_ld.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                   AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
            ) AS ultima_distribuicao,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n7
             WHERE n7.administrador_id = a.id
               AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
               AND COALESCE(n7.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux7
                 WHERE aux7.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                   AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
            ) AS notas_7d,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n_hj
             WHERE n_hj.administrador_id = a.id
               AND n_hj.distribuida_em >= CURRENT_DATE
               AND COALESCE(n_hj.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux_hj
                 WHERE aux_hj.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n_hj.numero_nota), '0'), ''), '0')
                   AND aux_hj.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
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
      'Distribuicao automatica (' || v_especialidade || CASE WHEN v_pula_cockpit THEN '/pula_cockpit' ELSE '' END || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id          := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas    := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$;
