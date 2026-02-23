-- 00064_fix_notes_leak_when_order_has_null_nota_id.sql
-- Corrige vazamento no Painel de Notas quando a ordem existe em
-- ordens_notas_acompanhamento com numero_nota preenchido, mas nota_id = NULL.
--
-- Objetivos:
-- 1) Backfill: relink de ordens -> nota por numero_nota
-- 2) Backfill: preencher ordem_gerada e concluir notas abertas que já têm ordem
-- 3) Endurecer vw_notas_sem_ordem para bloquear por nota_id OU numero_nota
-- 4) Endurecer distribuir_notas para não redistribuir notas já vinculadas a ordem

-- ============================================================
-- 1) RELINK: ordens com nota_id NULL usando numero_nota
-- ============================================================
WITH relink AS (
  SELECT
    o.id AS ordem_id,
    n.id AS nota_id
  FROM public.ordens_notas_acompanhamento o
  JOIN public.notas_manutencao n
    ON COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
       = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
  WHERE o.nota_id IS NULL
    AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
)
UPDATE public.ordens_notas_acompanhamento o
SET
  nota_id = r.nota_id,
  updated_at = now()
FROM relink r
WHERE o.id = r.ordem_id;

-- ============================================================
-- 2) BACKFILL: notas com ordem vinculada (por nota_id/numero_nota)
-- ============================================================
WITH ordens_com_nota AS (
  SELECT
    COALESCE(
      o.nota_id,
      n.id
    ) AS nota_id_resolvida,
    o.ordem_codigo,
    COALESCE(o.status_atualizado_em, o.ordem_detectada_em, o.updated_at, o.created_at) AS ordem_ts,
    o.id AS ordem_id
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n
    ON o.nota_id IS NULL
   AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
       = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
  WHERE COALESCE(o.nota_id, n.id) IS NOT NULL
),
ultima_ordem AS (
  SELECT
    nota_id_resolvida AS nota_id,
    ordem_codigo
  FROM (
    SELECT
      nota_id_resolvida,
      ordem_codigo,
      ROW_NUMBER() OVER (
        PARTITION BY nota_id_resolvida
        ORDER BY ordem_ts DESC, ordem_id DESC
      ) AS rn
    FROM ordens_com_nota
  ) ranked
  WHERE rn = 1
),
ordem_preenchida AS (
  UPDATE public.notas_manutencao n
  SET
    ordem_gerada = u.ordem_codigo,
    updated_at = now()
  FROM ultima_ordem u
  WHERE n.id = u.nota_id
    AND COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
  RETURNING n.id
),
status_para_corrigir AS (
  SELECT
    n.id AS nota_id,
    n.status::TEXT AS status_anterior,
    u.ordem_codigo
  FROM public.notas_manutencao n
  JOIN ultima_ordem u
    ON u.nota_id = n.id
  WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
),
status_corrigido AS (
  UPDATE public.notas_manutencao n
  SET
    status = 'concluida',
    ordem_gerada = COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), s.ordem_codigo),
    updated_at = now()
  FROM status_para_corrigir s
  WHERE n.id = s.nota_id
  RETURNING n.id AS nota_id, s.status_anterior
)
INSERT INTO public.notas_historico (
  nota_id,
  campo_alterado,
  valor_anterior,
  valor_novo,
  alterado_por,
  motivo
)
SELECT
  sc.nota_id,
  'status',
  sc.status_anterior,
  'concluida',
  NULL,
  'Correção estrutural: nota aberta com ordem vinculada (match por nota_id/numero_nota)'
FROM status_corrigido sc;

-- ============================================================
-- 3) VIEW CANÔNICA: bloqueia ordem por nota_id OU numero_nota
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT n.*
FROM public.notas_manutencao n
WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL
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
  );

-- ============================================================
-- 4) DISTRIBUIÇÃO: não redistribuir nota já vinculada a ordem
-- ============================================================
CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
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
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

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
      distribuida_em = now(),
      updated_at = now()
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

    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
