-- 00060_fix_geral_fallback.sql
-- Corrige fallback de ordens para admins GERAL.
--
-- Problema: pick_fallback_admin_for_order não filtrava por especialidade,
-- podendo selecionar Suelem (refrigeração) ou outros especialistas para ordens
-- genéricas. Quando esses especialistas estão indisponíveis (férias/bloqueio),
-- a função retorna NULL → ordens ficam sem responsável.
--
-- Regra de negócio (confirmada): sem keyword match = GERAL.
-- Refrigeração → Suelem; CD → Brenda/Adriano; resto → GERAL (fallback).
--
-- Mudanças:
-- 1. Garante recebe_distribuicao = true para admins geral ativos
-- 2. pick_fallback_admin_for_order restrito a especialidade = 'geral'
-- 3. Backfill: notas sem administrador → atribuição por especialidade + fallback geral
-- 4. Backfill: ordens standalone → re-executa atribuir_responsavel_ordens_standalone

-- ============================================================
-- 1) GUARD: recebe_distribuicao = true PARA ADMINS GERAL ATIVOS
-- ============================================================
UPDATE public.administradores
SET
  recebe_distribuicao = true,
  motivo_bloqueio     = NULL,
  updated_at          = now()
WHERE especialidade        = 'geral'
  AND ativo                = true
  AND recebe_distribuicao  = false;

-- ============================================================
-- 2) FIX: pick_fallback_admin_for_order
--    Antes: qualquer admin elegível (incluindo refrigeração/elevadores)
--    Depois: somente admins com especialidade = 'geral'
-- ============================================================
CREATE OR REPLACE FUNCTION public.pick_fallback_admin_for_order(
  p_centro TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  -- p_centro mantido para evolução futura por unidade.
  SELECT a.id
  INTO v_admin_id
  FROM public.administradores a
  LEFT JOIN public.notas_manutencao n
    ON n.administrador_id = a.id
  WHERE a.role            = 'admin'
    AND a.especialidade   = 'geral'    -- restrito a geral (correção central)
    AND a.ativo           = true
    AND a.recebe_distribuicao = true
    AND a.em_ferias       = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    )
  GROUP BY a.id, a.nome
  ORDER BY
    COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) ASC,
    a.nome ASC
  LIMIT 1;

  RETURN v_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.pick_fallback_admin_for_order(TEXT) IS
  'Admin GERAL (especialidade=geral) com menor carga ativo, recebe_distribuicao=true e fora '
  'de ferias. Fallback para ordens standalone sem correspondência de especialidade.';

-- ============================================================
-- 3) BACKFILL: NOTAS SEM ADMINISTRADOR
--    Distribui notas sem admin usando keyword match + fallback geral.
--    Igual à lógica de distribuir_notas, mas sem filtro de status.
-- ============================================================
DO $$
DECLARE
  v_nota          RECORD;
  v_admin         RECORD;
  v_especialidade TEXT;
BEGIN
  FOR v_nota IN
    SELECT id, descricao
    FROM public.notas_manutencao
    WHERE administrador_id IS NULL
    ORDER BY data_criacao_sap ASC NULLS LAST, created_at ASC
  LOOP
    -- Keyword match (mesma lógica de distribuir_notas)
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    -- Sem match → geral (regra confirmada)
    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Admin da especialidade com menor carga de notas abertas
    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
    WHERE a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
      AND (
        a.data_inicio_ferias IS NULL
        OR a.data_fim_ferias IS NULL
        OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
      )
    GROUP BY a.id, a.nome
    HAVING COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < a.max_notas
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    -- Fallback para geral se especialista não disponível
    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
      WHERE a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
        AND (
          a.data_inicio_ferias IS NULL
          OR a.data_fim_ferias IS NULL
          OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
        )
      GROUP BY a.id, a.nome
      HAVING COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      ) < a.max_notas
      ORDER BY open_count ASC, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NOT NULL THEN
      UPDATE public.notas_manutencao
      SET
        administrador_id = v_admin.id,
        distribuida_em   = now(),
        updated_at       = now()
      WHERE id = v_nota.id;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 4) BACKFILL: ORDENS STANDALONE SEM DONO
--    Re-executa atribuição após o fix de pick_fallback_admin_for_order.
--    Agora o fallback aponta corretamente para admins geral.
-- ============================================================
SELECT * FROM public.atribuir_responsavel_ordens_standalone();
