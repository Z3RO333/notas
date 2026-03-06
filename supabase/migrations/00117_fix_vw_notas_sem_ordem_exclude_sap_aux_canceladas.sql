-- 00117_fix_vw_notas_sem_ordem_exclude_sap_aux_canceladas.sql
--
-- Problema:
--   A view vw_notas_sem_ordem retornava 236 notas mas apenas ~95 são genuinamente
--   abertas. Diagnóstico: 141 notas têm status_canonico = 'CANCELADA' na tabela
--   notas_status_sap_aux (planilha SAP auxiliar), mas a view não consultava essa
--   tabela. A função sincronizar_cockpit_convergencia já filtrava corretamente;
--   o painel de notas (que usa vw_notas_sem_ordem diretamente) não filtrava.
--
-- Correção:
--   Adiciona filtro NOT EXISTS em notas_status_sap_aux para excluir notas com
--   status_canonico IN ('CANCELADA', 'VIROU_ORDEM') importadas nas últimas 48h.
--   Janela de 48h idêntica à usada em sincronizar_cockpit_convergencia (00111).
--   Sem janela de frescor, notas abertas poderiam desaparecer por dados stale.
--
--   Também atualiza distribuir_notas para não distribuir notas já canceladas/com
--   ordem confirmada no aux, evitando trabalho indevido.
--
-- Resultado esperado:
--   vw_notas_sem_ordem retorna ~95 notas abertas reais (vs 236 antes).

-- ============================================================
-- 1) View vw_notas_sem_ordem com filtro de status aux SAP
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT
  id, numero_nota, tipo_nota, descricao, descricao_objeto,
  prioridade, tipo_prioridade, criado_por_sap, solicitante,
  data_criacao_sap, data_nota, hora_nota, ordem_sap, centro,
  status_sap, conta_fornecedor, autor_nota, streaming_timestamp,
  status, administrador_id, distribuida_em, ordem_gerada,
  fornecedor_encaminhado, observacoes, sync_id, raw_data,
  created_at, updated_at
FROM public.notas_manutencao n
WHERE status = ANY (ARRAY[
    'nova'::nota_status,
    'em_andamento'::nota_status,
    'encaminhada_fornecedor'::nota_status
  ])
  -- Nota genuinamente sem ordem SAP (campo ordem_sap nulo ou vazio)
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  -- Sem ordem ATIVA por FK (caminho rápido)
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  )
  -- Sem ordem ATIVA por numero_nota (fallback para ordens sem FK)
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(ltrim(btrim(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  )
  -- Sem status de cancelamento/ordem confirmada no aux SAP (frescor de 48h)
  AND NOT EXISTS (
    SELECT 1
    FROM public.notas_status_sap_aux aux
    WHERE aux.numero_nota_norm
            = COALESCE(NULLIF(ltrim(btrim(n.numero_nota), '0'), ''), '0')
      AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
      AND aux.importado_em >= now() - interval '48 hours'
  );

COMMENT ON VIEW public.vw_notas_sem_ordem IS
  'Notas abertas genuinamente sem ordem SAP e sem ordem ativa no cockpit. '
  'Fix 00117: exclui notas com status_canonico CANCELADA/VIROU_ORDEM em '
  'notas_status_sap_aux (frescor 48h), alinhando com sincronizar_cockpit_convergencia. '
  'Resultado esperado: ~95 notas reais (vs 236 antes do fix).';

-- ============================================================
-- 2) Índice de suporte ao novo filtro (numero_nota_norm + status + importado_em)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_notas_status_sap_aux_norm_status_importado
  ON public.notas_status_sap_aux (numero_nota_norm, status_canonico, importado_em DESC)
  WHERE status_canonico IN ('CANCELADA', 'VIROU_ORDEM');

-- ============================================================
-- 3) distribuir_notas: exclui notas canceladas/com ordem no aux SAP
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
      -- Não distribuir notas canceladas ou com ordem confirmada no aux SAP (frescor 48h)
      AND NOT EXISTS (
        SELECT 1
        FROM public.notas_status_sap_aux aux
        WHERE aux.numero_nota_norm
                = COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
          AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
          AND aux.importado_em >= now() - interval '48 hours'
      )
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Keyword match: determina especialidade pela descrição da nota.
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
  'Distribui notas por especialidade via keyword match. '
  'Fix 00117: exclui notas com status_canonico CANCELADA/VIROU_ORDEM em notas_status_sap_aux (48h). '
  'Score especialistas = notas_abertas; score geral = notas_abertas + ordens_ativas*0.5. '
  'Fallback para geral; CONTINUE quando sem admin disponível.';
