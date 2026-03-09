-- 00129_distribuicao_deficit_semanal.sql
--
-- Substitui o critério de distribuição de notas:
--   Antes: menor score_carga instantâneo (abertas + ordens×0.5)
--   Depois: maior prioridade = déficit semanal (meta - carga_7d)
--           com penalidade progressiva por faixa de backlog aberto.
--
-- Fórmula:
--   carga_7d      = notas_recebidas_7d × 1.0 + ordens_detectadas_7d × 0.5
--   penalidade    = faixa(abertas_atuais) + ordens_ativas × 0.5
--   prioridade    = (meta_semanal - carga_7d) - penalidade
--
-- Faixas de penalidade (abertas_atuais):
--   0–10   → 0
--   11–20  → 8
--   21–30  → 20
--   31+    → 40
--
-- Sem bloqueio duro: max_notas já não é critério de exclusão.
-- Tiebreaker: ultima_distribuicao ASC NULLS FIRST (round-robin aproximado) → nome ASC.

-- Passo 1: nova coluna meta_semanal
ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS meta_semanal INTEGER NOT NULL DEFAULT 80;

COMMENT ON COLUMN public.administradores.meta_semanal IS
  'Meta de carga semanal do admin. Usada no cálculo de déficit para priorização de distribuição.';

-- Passo 2: novo distribuir_notas
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
    -- Keyword match: determina especialidade pela descrição da nota
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY r.prioridade ASC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');

    -- Seleciona admin com maior prioridade (especialidade exata)
    SELECT
      a.id,
      COUNT(DISTINCT n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count,
      (
        -- déficit semanal base
        a.meta_semanal
        - (
            COUNT(DISTINCT n2.id) FILTER (
              WHERE n2.distribuida_em >= NOW() - INTERVAL '7 days'
            ) * 1.0
            + COUNT(DISTINCT o2.id) FILTER (
              WHERE o2.ordem_detectada_em >= NOW() - INTERVAL '7 days'
            ) * 0.5
          )
        -- penalidade por faixa de backlog aberto
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
        -- penalidade por ordens ativas (backlog de ordens)
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

    -- Fallback para geral se especialista indisponível
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
