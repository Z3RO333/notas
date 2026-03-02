-- 00105_distribuir_notas_score_ordens.sql
--
-- Melhoria: distribuir_notas() passa a usar score ponderado que considera
-- tanto notas abertas quanto ordens ativas do admin.
--
-- Score = notas_abertas + (ordens_ativas × 0.5)
-- Ordens ativas = status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
--
-- Também cria vw_carga_real_administradores para uso no painel admin (page.tsx).

-- ============================================================
-- 1) VIEW: carga real por admin (notas abertas + ordens ativas)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_real_administradores AS
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
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'nova'
  )::INTEGER AS qtd_nova,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'em_andamento'
  )::INTEGER AS qtd_em_andamento,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'encaminhada_fornecedor'
  )::INTEGER AS qtd_encaminhada,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  )::INTEGER AS qtd_abertas,
  COUNT(DISTINCT n.id) FILTER (
    WHERE n.status = 'concluida'
  )::INTEGER AS qtd_concluidas,
  COUNT(DISTINCT o.id) FILTER (
    WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
  )::INTEGER AS qtd_ordens_ativas,
  ROUND(
    COUNT(DISTINCT n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    )
    + COUNT(DISTINCT o.id) FILTER (
      WHERE o.status_ordem_raw IN ('ABERTO', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO')
    ) * 0.5
  )::INTEGER AS score_carga
FROM public.administradores a
LEFT JOIN public.notas_manutencao n
  ON n.administrador_id = a.id
LEFT JOIN public.ordens_notas_acompanhamento o
  ON o.nota_id = n.id
WHERE a.role = 'admin'
GROUP BY
  a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url,
  a.especialidade, a.recebe_distribuicao, a.em_ferias,
  a.data_inicio_ferias, a.data_fim_ferias, a.motivo_bloqueio;

COMMENT ON VIEW public.vw_carga_real_administradores IS
  'Carga real do admin: notas abertas + ordens ativas (ABERTO/EM_EXECUCAO/EQUIPAMENTO_EM_CONSERTO × 0.5). '
  'score_carga é usado em distribuir_notas() para balancear carga considerando ordens pendentes. '
  'Criado em 00105.';

-- ============================================================
-- 2) FUNÇÃO: distribuir_notas() com score ponderado
-- ============================================================
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
    -- Keyword match: determina especialidade pela descrição da nota
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY r.prioridade ASC NULLS LAST
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Admin da especialidade com menor SCORE (notas_abertas + ordens_ativas × 0.5)
    -- respeitando max_notas
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
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome, a.max_notas
    HAVING COUNT(DISTINCT n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < COALESCE(a.max_notas, 9999)
    ORDER BY score ASC, a.nome ASC
    LIMIT 1;

    -- Fallback para geral se especialista indisponível
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

    -- CONTINUE (não EXIT): pula esta nota e tenta a próxima
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
  'Distribui notas novas sem responsável por especialidade (keyword match em regras_distribuicao). '
  'Score = notas_abertas + (ordens_ativas × 0.5). Ordens ativas = ABERTO/EM_EXECUCAO/EQUIPAMENTO_EM_CONSERTO. '
  'CONTINUE (não EXIT) quando admin indisponível: pula a nota, não para a fila inteira. '
  'Respeita max_notas. SET search_path = public (SECURITY DEFINER). Atualizado em 00105.';
