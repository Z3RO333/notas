-- 00131_fix_distribuir_notas_order_by.sql
--
-- Bug: distribuir_notas() (00129) reintroduziu ORDER BY r.prioridade no keyword match,
-- mas regras_distribuicao não tem coluna prioridade (apenas id, palavra_chave,
-- especialidade, created_at). Isso causava erro 42703 em runtime em toda execução
-- pelo pg_cron, impedindo qualquer distribuição automática desde 00129.
--
-- Mesmo bug foi corrigido antes em 00116 (função com score), mas reintroduzido em 00129
-- ao reescrever a função com o sistema de déficit semanal.
--
-- Fix: substituir ORDER BY r.prioridade por ORDER BY LENGTH(r.palavra_chave) DESC
-- (keyword mais longa = mais específica = ganha em caso de múltiplos matches).
--
-- Nota: a query de seleção do admin ainda usa 4 LEFT JOINs (n, n2, o, o2).
-- Isso foi corrigido em 00132/00133 por causar "No space left on device" no temp.

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
    -- Keyword match: keyword mais longa (mais específica) ganha em empate
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');

    SELECT
      a.id,
      COUNT(DISTINCT n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count,
      (
        a.meta_semanal
        - (
            COUNT(DISTINCT n2.id) FILTER (
              WHERE n2.distribuida_em >= NOW() - INTERVAL '7 days'
            ) * 1.0
            + COUNT(DISTINCT o2.id) FILTER (
              WHERE o2.ordem_detectada_em >= NOW() - INTERVAL '7 days'
            ) * 0.5
          )
        - CASE
            WHEN COUNT(DISTINCT n.id) FILTER (
              WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
            ) <= 10 THEN 0
            WHEN COUNT(DISTINCT n.id) FILTER (
              WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
            ) <= 20 THEN 8
            WHEN COUNT(DISTINCT n.id) FILTER (
              WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
            ) <= 30 THEN 20
            ELSE 40
          END
        - COUNT(DISTINCT o.id) FILTER (
            WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
          ) * 0.5
      ) AS prioridade,
      MAX(n2.distribuida_em) AS ultima_distribuicao
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n   ON n.administrador_id = a.id
    LEFT JOIN public.notas_manutencao n2  ON n2.administrador_id = a.id
    LEFT JOIN public.ordens_notas_acompanhamento o  ON o.nota_id = n.id
    LEFT JOIN public.ordens_notas_acompanhamento o2 ON o2.administrador_id = a.id
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome, a.max_notas, a.meta_semanal
    ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(DISTINCT n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count,
        (
          a.meta_semanal
          - (
              COUNT(DISTINCT n2.id) FILTER (
                WHERE n2.distribuida_em >= NOW() - INTERVAL '7 days'
              ) * 1.0
              + COUNT(DISTINCT o2.id) FILTER (
                WHERE o2.ordem_detectada_em >= NOW() - INTERVAL '7 days'
              ) * 0.5
            )
          - CASE
              WHEN COUNT(DISTINCT n.id) FILTER (
                WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
              ) <= 10 THEN 0
              WHEN COUNT(DISTINCT n.id) FILTER (
                WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
              ) <= 20 THEN 8
              WHEN COUNT(DISTINCT n.id) FILTER (
                WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
              ) <= 30 THEN 20
              ELSE 40
            END
          - COUNT(DISTINCT o.id) FILTER (
              WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
            ) * 0.5
        ) AS prioridade,
        MAX(n2.distribuida_em) AS ultima_distribuicao
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n   ON n.administrador_id = a.id
      LEFT JOIN public.notas_manutencao n2  ON n2.administrador_id = a.id
      LEFT JOIN public.ordens_notas_acompanhamento o  ON o.nota_id = n.id
      LEFT JOIN public.ordens_notas_acompanhamento o2 ON o2.administrador_id = a.id
      WHERE a.role = 'admin'
        AND a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.nome, a.max_notas, a.meta_semanal
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN
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
