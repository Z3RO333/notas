-- 00116_fix_distribuir_notas_regra_order_without_prioridade.sql
--
-- Hotfix:
-- A função public.distribuir_notas (vinda de 00105/00106) fazia:
--   ORDER BY r.prioridade
-- porém a tabela public.regras_distribuicao não possui essa coluna.
-- Resultado: erro 42703 em runtime ao distribuir notas.
--
-- Solução:
-- Recria a função usando ordenação determinística sem depender de coluna inexistente:
--   1) palavra-chave mais específica primeiro (maior comprimento)
--   2) created_at mais antigo
--   3) id para desempate

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
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Keyword match: determina especialidade pela descrição da nota.
    -- Sem coluna "prioridade": usa maior palavra-chave primeiro (mais específica).
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

    -- Admin da especialidade com menor score.
    -- Para especialistas: score = só notas_abertas (ordens são exclusivas deles).
    -- Para geral: score = notas_abertas + (ordens_ativas × 0.5).
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

    -- Fallback para geral se especialista indisponível.
    -- Geral sempre usa score com peso de ordens.
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
  'Distribui notas por especialidade via keyword match sem depender de regras_distribuicao.prioridade (inexistente). '
  'Score especialistas = notas_abertas; score geral = notas_abertas + ordens_ativas*0.5. '
  'Fallback para geral; CONTINUE quando sem admin disponível. Hotfix 00116.';
