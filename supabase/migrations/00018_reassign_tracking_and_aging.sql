-- 00018_reassign_tracking_and_aging.sql
-- Reatribuição obrigatória em lote + acompanhamento de ordens reatribuídas

-- ============================================================
-- 1) TABELA DE ACOMPANHAMENTO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.nota_acompanhamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  administrador_id UUID NOT NULL REFERENCES public.administradores(id) ON DELETE CASCADE,
  origem TEXT NOT NULL DEFAULT 'reatribuicao',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_nota_acompanhamentos_nota_admin UNIQUE (nota_id, administrador_id)
);

CREATE INDEX IF NOT EXISTS idx_nota_acompanhamentos_nota
  ON public.nota_acompanhamentos (nota_id);

CREATE INDEX IF NOT EXISTS idx_nota_acompanhamentos_admin
  ON public.nota_acompanhamentos (administrador_id);

ALTER TABLE public.nota_acompanhamentos DISABLE ROW LEVEL SECURITY;

-- Backfill dos responsáveis anteriores históricos
WITH historico_reassign AS (
  SELECT
    h.nota_id,
    h.valor_anterior,
    h.created_at
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'administrador_id'
    AND h.valor_anterior IS NOT NULL
    AND h.valor_anterior <> 'NULL'
    AND h.valor_anterior ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem, created_at)
SELECT
  r.nota_id,
  a.id,
  'reatribuicao_backfill',
  r.created_at
FROM historico_reassign r
JOIN public.administradores a ON a.id = r.valor_anterior::UUID
ON CONFLICT (nota_id, administrador_id) DO NOTHING;

-- ============================================================
-- 2) REATRIBUICAO INDIVIDUAL COM ACOMPANHAMENTO
-- ============================================================
CREATE OR REPLACE FUNCTION public.reatribuir_nota(
  p_nota_id UUID,
  p_novo_admin_id UUID,
  p_gestor_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS public.notas_manutencao AS $$
DECLARE
  v_nota public.notas_manutencao;
  v_old_admin_id UUID;
BEGIN
  PERFORM 1
  FROM public.administradores g
  WHERE g.id = p_gestor_id
    AND g.role = 'gestor'
    AND g.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gestor inválido para reatribuição';
  END IF;

  SELECT * INTO v_nota
  FROM public.notas_manutencao
  WHERE id = p_nota_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota % não encontrada', p_nota_id;
  END IF;

  v_old_admin_id := v_nota.administrador_id;

  IF v_old_admin_id IS NOT NULL AND v_old_admin_id = p_novo_admin_id THEN
    RAISE EXCEPTION 'Novo responsável deve ser diferente do atual';
  END IF;

  PERFORM 1
  FROM public.administradores a
  WHERE a.id = p_novo_admin_id
    AND a.role = 'admin'
    AND a.ativo = true
    AND a.em_ferias = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destino inválido: admin deve estar ativo e fora de férias';
  END IF;

  UPDATE public.notas_manutencao
  SET
    administrador_id = p_novo_admin_id,
    distribuida_em = now(),
    updated_at = now()
  WHERE id = p_nota_id
  RETURNING * INTO v_nota;

  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
  VALUES (
    p_nota_id,
    'administrador_id',
    COALESCE(v_old_admin_id::TEXT, 'NULL'),
    p_novo_admin_id::TEXT,
    p_gestor_id,
    COALESCE(p_motivo, 'Reatribuição manual pelo gestor')
  );

  IF v_old_admin_id IS NOT NULL THEN
    INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
    VALUES (p_nota_id, v_old_admin_id, 'reatribuicao')
    ON CONFLICT (nota_id, administrador_id) DO NOTHING;
  END IF;

  RETURN v_nota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3) REATRIBUICAO EM LOTE
-- ============================================================
CREATE OR REPLACE FUNCTION public.reatribuir_notas_lote(
  p_admin_origem UUID,
  p_gestor_id UUID,
  p_modo TEXT,
  p_admin_destino UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(nota_id UUID, administrador_destino_id UUID) AS $$
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
    RAISE EXCEPTION 'Gestor inválido para reatribuição em lote';
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido. Use destino_unico ou round_robin';
  END IF;

  PERFORM 1
  FROM public.administradores a
  WHERE a.id = p_admin_origem
    AND a.role = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin de origem inválido';
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
      AND a.em_ferias = false
      AND a.id <> p_admin_origem;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destino unico inválido';
    END IF;
  ELSE
    SELECT array_agg(a.id ORDER BY a.nome) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.id <> p_admin_origem;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Não existem destinos elegíveis para round_robin';
    END IF;
  END IF;

  FOR v_nota IN
    SELECT nm.id, nm.administrador_id
    FROM public.notas_manutencao nm
    WHERE nm.administrador_id = p_admin_origem
      AND nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ORDER BY COALESCE(nm.data_criacao_sap::TIMESTAMP, nm.created_at), nm.created_at
    FOR UPDATE
  LOOP
    IF p_modo = 'destino_unico' THEN
      v_destino := p_admin_destino;
    ELSE
      v_destino := v_destinos[v_rr_index];
      v_rr_index := (v_rr_index % v_destinos_count) + 1;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_destino,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      COALESCE(v_nota.administrador_id::TEXT, 'NULL'),
      v_destino::TEXT,
      p_gestor_id,
      COALESCE(p_motivo, 'Reatribuição em lote pelo gestor (' || p_modo || ')')
    );

    IF v_nota.administrador_id IS NOT NULL THEN
      INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
      VALUES (v_nota.id, v_nota.administrador_id, 'reatribuicao')
      ON CONFLICT (nota_id, administrador_id) DO NOTHING;
    END IF;

    nota_id := v_nota.id;
    administrador_destino_id := v_destino;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4) VIEW: ORDENS EM ACOMPANHAMENTO
-- ============================================================
CREATE OR REPLACE VIEW public.vw_ordens_acompanhamento AS
SELECT
  na.id AS acompanhamento_id,
  na.nota_id,
  na.administrador_id,
  adm.nome AS administrador_nome,
  nm.administrador_id AS responsavel_atual_id,
  atual.nome AS responsavel_atual_nome,
  nm.numero_nota,
  nm.descricao,
  nm.status,
  nm.ordem_gerada,
  nm.data_criacao_sap,
  nm.created_at,
  na.created_at AS acompanhamento_em
FROM public.nota_acompanhamentos na
JOIN public.notas_manutencao nm ON nm.id = na.nota_id
LEFT JOIN public.administradores adm ON adm.id = na.administrador_id
LEFT JOIN public.administradores atual ON atual.id = nm.administrador_id
WHERE nm.ordem_gerada IS NOT NULL;

-- ============================================================
-- 5) VIEW: PERSPECTIVA ADMINISTRATIVA (30d)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_perspectiva_reatribuicao_admin_30d AS
WITH enviadas AS (
  SELECT
    h.valor_anterior::UUID AS administrador_id,
    COUNT(*)::BIGINT AS qtd_enviadas_30d
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'administrador_id'
    AND h.created_at >= now() - INTERVAL '30 days'
    AND h.valor_anterior IS NOT NULL
    AND h.valor_anterior <> 'NULL'
    AND h.valor_anterior ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  GROUP BY h.valor_anterior::UUID
),
recebidas AS (
  SELECT
    h.valor_novo::UUID AS administrador_id,
    COUNT(*)::BIGINT AS qtd_recebidas_30d
  FROM public.notas_historico h
  WHERE h.campo_alterado = 'administrador_id'
    AND h.created_at >= now() - INTERVAL '30 days'
    AND h.valor_novo IS NOT NULL
    AND h.valor_novo <> 'NULL'
    AND h.valor_novo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  GROUP BY h.valor_novo::UUID
),
acompanhando_abertas AS (
  SELECT
    na.administrador_id,
    COUNT(*)::BIGINT AS qtd_ordens_acompanhando_abertas
  FROM public.nota_acompanhamentos na
  JOIN public.notas_manutencao nm ON nm.id = na.nota_id
  WHERE nm.ordem_gerada IS NOT NULL
    AND nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  GROUP BY na.administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  COALESCE(e.qtd_enviadas_30d, 0)::BIGINT AS qtd_enviadas_30d,
  COALESCE(r.qtd_recebidas_30d, 0)::BIGINT AS qtd_recebidas_30d,
  COALESCE(ab.qtd_ordens_acompanhando_abertas, 0)::BIGINT AS qtd_ordens_acompanhando_abertas
FROM public.administradores a
LEFT JOIN enviadas e ON e.administrador_id = a.id
LEFT JOIN recebidas r ON r.administrador_id = a.id
LEFT JOIN acompanhando_abertas ab ON ab.administrador_id = a.id
WHERE a.role = 'admin'
ORDER BY a.nome;
