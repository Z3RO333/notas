-- 00132_fix_distribuir_notas_query_efficiency.sql
--
-- Bug: a query de seleção do admin usava 4 LEFT JOINs (n, n2, o, o2) que
-- criavam produto cartesiano explosivo → "No space left on device" no temp
-- durante sort do ORDER BY.
--
-- Tentativa intermediária: substituir por subqueries correlacionadas inline no SELECT.
-- Esta versão tem lógica de seleção parcialmente correta mas estrutura _unused confusa.
-- Supersedida por 00133 (versão CTE limpa).
--
-- Aplicada ao DB mas supersedida imediatamente por 00133.

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
    SELECT n.id, n.descricao, n.data_criacao_sap, n.created_at
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
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');

    -- Versão intermediária com ORDER BY inline (subqueries correlacionadas)
    -- Estrutura com _unused — supersedida por 00133
    SELECT
      a.id,
      (
        SELECT COUNT(DISTINCT n_open.id)
        FROM public.notas_manutencao n_open
        WHERE n_open.administrador_id = a.id
          AND n_open.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count,
      NULL::NUMERIC AS _unused,
      MAX(n_last.distribuida_em) AS ultima_distribuicao
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n_last ON n_last.administrador_id = a.id
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome, a.max_notas, a.meta_semanal
    ORDER BY (
      a.meta_semanal
      - (
          (SELECT COUNT(*) FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days') * 1.0
          + (SELECT COUNT(*) FROM public.ordens_notas_acompanhamento o7
             WHERE o7.administrador_id = a.id
               AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days') * 0.5
        )
      - CASE
          WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                WHERE n_ab.administrador_id = a.id
                  AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 10 THEN 0
          WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                WHERE n_ab.administrador_id = a.id
                  AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 20 THEN 8
          WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                WHERE n_ab.administrador_id = a.id
                  AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 30 THEN 20
          ELSE 40
        END
      - (SELECT COUNT(*) FROM public.notas_manutencao n_oa
         JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
         WHERE n_oa.administrador_id = a.id
           AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')) * 0.5
    ) DESC NULLS LAST,
    MAX(n_last.distribuida_em) ASC NULLS FIRST,
    a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL OR v_admin.id IS NULL THEN
      IF v_especialidade != 'geral' THEN
        SELECT
          a.id,
          (
            SELECT COUNT(DISTINCT n_open.id)
            FROM public.notas_manutencao n_open
            WHERE n_open.administrador_id = a.id
              AND n_open.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          )::INTEGER AS open_count,
          NULL::NUMERIC AS _unused,
          MAX(n_last.distribuida_em) AS ultima_distribuicao
        INTO v_admin
        FROM public.administradores a
        LEFT JOIN public.notas_manutencao n_last ON n_last.administrador_id = a.id
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = 'geral'
        GROUP BY a.id, a.nome, a.max_notas, a.meta_semanal
        ORDER BY (
          a.meta_semanal
          - (
              (SELECT COUNT(*) FROM public.notas_manutencao n7
               WHERE n7.administrador_id = a.id
                 AND n7.distribuida_em >= NOW() - INTERVAL '7 days') * 1.0
              + (SELECT COUNT(*) FROM public.ordens_notas_acompanhamento o7
                 WHERE o7.administrador_id = a.id
                   AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days') * 0.5
            )
          - CASE
              WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                    WHERE n_ab.administrador_id = a.id
                      AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 10 THEN 0
              WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                    WHERE n_ab.administrador_id = a.id
                      AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 20 THEN 8
              WHEN (SELECT COUNT(*) FROM public.notas_manutencao n_ab
                    WHERE n_ab.administrador_id = a.id
                      AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')) <= 30 THEN 20
              ELSE 40
            END
          - (SELECT COUNT(*) FROM public.notas_manutencao n_oa
             JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
             WHERE n_oa.administrador_id = a.id
               AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')) * 0.5
        ) DESC NULLS LAST,
        MAX(n_last.distribuida_em) ASC NULLS FIRST,
        a.nome ASC
        LIMIT 1;
      END IF;
    END IF;

    IF v_admin IS NULL OR v_admin.id IS NULL THEN
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
