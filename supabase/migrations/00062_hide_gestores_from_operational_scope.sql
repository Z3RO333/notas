-- 00062_hide_gestores_from_operational_scope.sql
-- Remove gestores do escopo operacional (cards + distribuição + reatribuição).
-- Regras:
-- - Gestor nunca recebe distribuição.
-- - View de carga operacional exibe apenas role=admin.
-- - Distribuição automática e reatribuição de ordens aceitam apenas destinos admin.

-- ============================================================
-- 1) BACKFILL: gestor nunca recebe distribuição
-- ============================================================
UPDATE public.administradores
SET
  recebe_distribuicao = false,
  updated_at = now()
WHERE role = 'gestor'
  AND recebe_distribuicao = true;

-- ============================================================
-- 2) GUARDRAIL: impede não-admin com distribuição ativa
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'administradores_recebe_distribuicao_only_admin'
      AND conrelid = 'public.administradores'::regclass
  ) THEN
    ALTER TABLE public.administradores
      ADD CONSTRAINT administradores_recebe_distribuicao_only_admin
      CHECK (role = 'admin' OR recebe_distribuicao = false);
  END IF;
END;
$$;

-- ============================================================
-- 3) VIEW operacional: somente admins
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_administradores AS
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  COUNT(n.id) FILTER (WHERE n.status = 'nova') AS qtd_nova,
  COUNT(n.id) FILTER (WHERE n.status = 'em_andamento') AS qtd_em_andamento,
  COUNT(n.id) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
  COUNT(n.id) FILTER (WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas,
  COUNT(n.id) FILTER (WHERE n.status = 'concluida') AS qtd_concluidas,
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada') AS qtd_canceladas,
  a.recebe_distribuicao,
  a.em_ferias
FROM public.administradores a
LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url, a.especialidade, a.recebe_distribuicao, a.em_ferias;

-- ============================================================
-- 4) DISTRIBUIÇÃO: destino obrigatório role=admin
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

-- ============================================================
-- 5) REATRIBUIÇÃO DE ORDENS: destino único somente admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.reatribuir_ordens_selecionadas(
  p_nota_ids UUID[],
  p_gestor_id UUID,
  p_modo TEXT,
  p_admin_destino UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(nota_id UUID, administrador_destino_id UUID) AS $$
#variable_conflict use_column
DECLARE
  v_destinos UUID[];
  v_destinos_count INTEGER;
  v_rr_index INTEGER := 1;
  v_nota RECORD;
  v_destino UUID;
BEGIN
  PERFORM 1
  FROM public.administradores g
  WHERE g.id = p_gestor_id
    AND g.role = 'gestor'
    AND g.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gestor inválido para reatribuição em lote de ordens';
  END IF;

  IF p_nota_ids IS NULL OR COALESCE(array_length(p_nota_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido. Use destino_unico ou round_robin';
  END IF;

  IF p_modo = 'destino_unico' THEN
    IF p_admin_destino IS NULL THEN
      RAISE EXCEPTION 'Destino obrigatorio para modo destino_unico';
    END IF;

    PERFORM 1
    FROM public.administradores a
    WHERE a.id = p_admin_destino
      AND a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destino unico inválido';
    END IF;
  ELSE
    SELECT array_agg(a.id ORDER BY a.nome) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Não existem destinos elegíveis para round_robin';
    END IF;
  END IF;

  FOR v_nota IN
    SELECT nm.id AS nota_id, nm.administrador_id
    FROM public.notas_manutencao nm
    WHERE nm.id = ANY(p_nota_ids)
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NOT NULL
    ORDER BY nm.id
    FOR UPDATE
  LOOP
    IF p_modo = 'destino_unico' THEN
      v_destino := p_admin_destino;
    ELSE
      v_destino := v_destinos[v_rr_index];
      v_rr_index := (v_rr_index % v_destinos_count) + 1;
    END IF;

    IF v_nota.administrador_id IS NOT NULL AND v_nota.administrador_id = v_destino THEN
      CONTINUE;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_destino,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.nota_id;

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
    VALUES (
      v_nota.nota_id,
      'administrador_id',
      COALESCE(v_nota.administrador_id::TEXT, 'NULL'),
      v_destino::TEXT,
      p_gestor_id,
      COALESCE(p_motivo, 'Reatribuição em lote de ordens pelo gestor (' || p_modo || ')')
    );

    IF v_nota.administrador_id IS NOT NULL THEN
      INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
      VALUES (v_nota.nota_id, v_nota.administrador_id, 'reatribuicao_ordens_lote')
      ON CONFLICT ON CONSTRAINT uq_nota_acompanhamentos_nota_admin DO NOTHING;
    END IF;

    nota_id := v_nota.nota_id;
    administrador_destino_id := v_destino;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
