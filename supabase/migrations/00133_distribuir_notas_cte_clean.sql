-- 00133_distribuir_notas_cte_clean.sql
--
-- Versão final e limpa de distribuir_notas() com sistema de déficit semanal.
-- Supersede 00129, 00131, 00132.
--
-- Problemas corrigidos em relação a 00129:
--   1. ORDER BY r.prioridade → LENGTH(r.palavra_chave) DESC (coluna não existia)
--   2. 4 LEFT JOINs cartesianos → CTE com subqueries correlacionadas (evita OOM/disk)
--   3. Uso de NOT FOUND em vez de v_admin IS NULL (mais correto em PL/pgSQL)
--
-- Estrutura da CTE por admin:
--   open_count       = notas abertas atuais (faixa de penalidade)
--   ultima_distribuicao = MAX(distribuida_em) para round-robin
--   notas_7d         = notas recebidas nos últimos 7 dias
--   ordens_7d        = ordens detectadas nos últimos 7 dias
--   ordens_ativas    = ordens ativas agora (backlog de ordens)
--
-- Fórmula de prioridade:
--   meta_semanal - (notas_7d×1.0 + ordens_7d×0.5)
--   - faixa_penalidade(open_count)
--   - ordens_ativas × 0.5

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

    -- Seleciona admin com maior prioridade (especialidade exata)
    -- CTE agrega cada métrica independentemente por admin, sem produto cartesiano
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
        AND a.recebe_distribuicao = true
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

    -- Fallback para geral se especialista indisponível
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
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = 'geral'
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
    END IF;

    IF NOT FOUND THEN
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

COMMENT ON FUNCTION public.distribuir_notas(UUID) IS
  'Distribui notas por déficit semanal com penalidade por faixa de backlog. '
  'Prioridade = (meta_semanal - carga_7d) - faixa_penalidade - ordens_ativas×0.5. '
  'carga_7d = notas_7d×1.0 + ordens_7d×0.5. '
  'Faixas: ≤10→0, ≤20→8, ≤30→20, 31+→40. '
  'Tiebreaker: ultima_distribuicao ASC NULLS FIRST, nome ASC. '
  'CTE por admin evita produto cartesiano. Atualizado em 00133.';
