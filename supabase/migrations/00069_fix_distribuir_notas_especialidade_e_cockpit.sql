-- 00069_fix_distribuir_notas_especialidade_e_cockpit.sql
--
-- Fix 1: Restaura roteamento por especialidade em distribuir_notas.
--        A migration 00068 (pool global) removeu o filtro de especialidade,
--        fazendo admins de refrigeração (Suelem) receberem qualquer nota.
--        Mantém a melhoria válida do 00068: NOT EXISTS para notas já
--        vinculadas a ordens em ordens_notas_acompanhamento.
--
-- Fix 2: Corrige cockpit de notas (deve ter MAIS de 6 notas):
--   2a) Reabre notas canceladas indevidamente pelo backfill 00065
--       (DATA_ENC_NOTA vazia = só tinha previsão, não fechamento real)
--   2b) Re-cancela notas reabertas indevidamente pelo fix bugado da 00066
--       (LEFT JOIN bug: reabria notas canceladas por outras razões, ex: 10167660)

-- ============================================================
-- 1) RESTAURAR distribuir_notas COM ESPECIALIDADE + NOT EXISTS
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
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Admin da especialidade com menor carga
    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.nome
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    -- Fallback para geral se especialista indisponível
    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n
        ON n.administrador_id = a.id
      WHERE a.role = 'admin'
        AND a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.nome
      ORDER BY open_count ASC, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN
      EXIT;
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

    nota_id      := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas    := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.distribuir_notas(UUID) IS
  'Distribui notas novas sem responsável por especialidade (keyword match em regras_distribuicao). '
  'Sem match → geral. Fallback: se especialista indisponível → geral. '
  'Exclui notas já vinculadas a ordens em ordens_notas_acompanhamento (NOT EXISTS). '
  'Restaurado por 00069 após 00068 ter removido o roteamento por especialidade (bug).';

-- ============================================================
-- 2a) COCKPIT — REABRIR notas canceladas por engano pela 00065
--
--     Critério: foram canceladas pelo backfill 00065 (motivo no historico),
--               têm DATA_ENC_NOTA vazia (era previsão, não fechamento SAP),
--               sem ordem vinculada, e ainda estão canceladas hoje.
--     Efeito: restaura ao status anterior (nova / em_andamento / encaminhada_fornecedor)
-- ============================================================
WITH canceladas_00065 AS (
  SELECT DISTINCT ON (h.nota_id)
    h.nota_id,
    LOWER(COALESCE(NULLIF(BTRIM(h.valor_anterior), ''), '')) AS status_anterior
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_novo = 'cancelada'
    AND h.motivo LIKE 'Backfill estrutural: encerramento SAP sem ordem%'
  ORDER BY h.nota_id, h.created_at DESC
),
candidatos_reabrir AS (
  SELECT
    n.id AS nota_id,
    CASE
      WHEN c.status_anterior IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        THEN c.status_anterior
      ELSE 'nova'
    END AS status_destino
  FROM public.notas_manutencao n
  JOIN canceladas_00065 c ON c.nota_id = n.id
  WHERE n.status = 'cancelada'
    AND COALESCE(NULLIF(BTRIM(n.raw_data->>'DATA_ENC_NOTA'), ''), '') = ''
    AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ordens_notas_acompanhamento o
      WHERE o.nota_id = n.id
         OR (
           o.nota_id IS NULL
           AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
           AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
               = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
         )
    )
),
reaberta AS (
  UPDATE public.notas_manutencao n
  SET
    status = CASE cr.status_destino
      WHEN 'em_andamento'         THEN 'em_andamento'::public.nota_status
      WHEN 'encaminhada_fornecedor' THEN 'encaminhada_fornecedor'::public.nota_status
      ELSE 'nova'::public.nota_status
    END,
    updated_at = now()
  FROM candidatos_reabrir cr
  WHERE n.id = cr.nota_id
  RETURNING n.id AS nota_id, cr.status_destino
)
INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
SELECT
  r.nota_id,
  'status',
  'cancelada',
  r.status_destino,
  'Fix 00069: reabertura de nota cancelada indevidamente pelo backfill 00065 (DATA_ENC_NOTA vazia)'
FROM reaberta r;

-- ============================================================
-- 2b) COCKPIT — RE-CANCELAR notas reabertas indevidamente pela 00066
--
--     Critério: historico tem entrada de reabertura pelo fix da 00066,
--               MAS não tem entrada de cancelamento pelo backfill 00065.
--               → foram canceladas por motivo independente (legítimo)
--                 e a 00066 as reabriu indevidamente por bug de LEFT JOIN.
-- ============================================================
WITH reaberta_por_00066 AS (
  SELECT DISTINCT h.nota_id
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'status'
    AND h.valor_anterior = 'cancelada'
    AND h.valor_novo IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND h.motivo = 'Correção estrutural: DATA_CONCLUSAO futura sem ordem (reabertura para fila operacional)'
),
cancelada_por_00065 AS (
  SELECT DISTINCT nota_id
  FROM public.notas_historico
  WHERE campo_alterado = 'status'
    AND valor_novo = 'cancelada'
    AND motivo LIKE 'Backfill estrutural: encerramento SAP sem ordem%'
),
candidatos_cancelar AS (
  SELECT
    n.id    AS nota_id,
    n.status::TEXT AS status_atual
  FROM public.notas_manutencao n
  WHERE EXISTS (SELECT 1 FROM reaberta_por_00066 r WHERE r.nota_id = n.id)
    AND NOT EXISTS (SELECT 1 FROM cancelada_por_00065 c WHERE c.nota_id = n.id)
    AND n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
),
status_corrigido AS (
  UPDATE public.notas_manutencao n
  SET status = 'cancelada', updated_at = now()
  FROM candidatos_cancelar c
  WHERE n.id = c.nota_id
  RETURNING c.nota_id, c.status_atual AS status_anterior
)
INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
SELECT
  sc.nota_id,
  'status',
  sc.status_anterior,
  'cancelada',
  'Fix 00069: re-cancelamento de nota reaberta indevidamente pela migration 00066 (LEFT JOIN bug)'
FROM status_corrigido sc;
