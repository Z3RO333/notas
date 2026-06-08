-- 00274_pedidos_compra_carteira_fornecedor_rpc_seed.sql
--
-- 1. RPC realocar_carteira_fornecedor_pedidos — troca o dono de um fornecedor da
--    carteira de Pedidos de Compra (gestor-only). NÃO reatribui pedidos históricos.
-- 2. Seed dos 8 fornecedores mapeados, com a divisão balanceada por valor/volume:
--      Paula      → NDS (10079) + Marcones (16977)
--      Mayky      → Brasferro (1441)
--      Fabíola    → Reforma Rápida (8141) + Lusivan (10171)
--      Rosana     → Sep Instalações (13166) + Renê (16472)
--      Wanderlucio→ Rio Negro (16883)

-- ============================================================
-- 1) RPC de realocação (transacional, gestor-only)
-- ============================================================
DROP FUNCTION IF EXISTS public.realocar_carteira_fornecedor_pedidos(TEXT, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.realocar_carteira_fornecedor_pedidos(
  p_fornecedor_codigo TEXT,
  p_novo_admin_id     UUID,
  p_gestor_id         UUID,
  p_motivo            TEXT DEFAULT NULL
)
RETURNS TABLE (
  fornecedor_codigo   TEXT,
  fornecedor_nome     TEXT,
  admin_anterior_id   UUID,
  admin_anterior_nome TEXT,
  admin_novo_id       UUID,
  admin_novo_nome     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo          TEXT;
  v_gestor_role     user_role;
  v_novo_role       user_role;
  v_novo_especialidade TEXT;
  v_novo_ativo      BOOLEAN;
  v_novo_nome       TEXT;
  v_anterior_id     UUID;
  v_anterior_nome   TEXT;
  v_fornecedor_nome TEXT;
BEGIN
  v_codigo := public.normalize_supplier_code(p_fornecedor_codigo);

  IF v_codigo IS NULL THEN
    RAISE EXCEPTION 'Código de fornecedor inválido: %', p_fornecedor_codigo;
  END IF;

  -- Valida gestor
  SELECT role INTO v_gestor_role
  FROM public.administradores
  WHERE id = p_gestor_id;

  IF v_gestor_role IS NULL THEN
    RAISE EXCEPTION 'Gestor não encontrado: %', p_gestor_id;
  END IF;

  IF v_gestor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Apenas gestores podem realocar a carteira de fornecedores de Pedidos de Compra.';
  END IF;

  -- Valida novo admin (admin geral)
  SELECT role, especialidade, ativo, nome
  INTO v_novo_role, v_novo_especialidade, v_novo_ativo, v_novo_nome
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  IF v_novo_role IS NULL THEN
    RAISE EXCEPTION 'Administrador destino não encontrado: %', p_novo_admin_id;
  END IF;

  IF NOT v_novo_ativo THEN
    RAISE EXCEPTION 'Administrador destino está inativo.';
  END IF;

  IF v_novo_role <> 'admin' OR v_novo_especialidade IS DISTINCT FROM 'geral' THEN
    RAISE EXCEPTION
      'Carteira de fornecedores de Pedidos de Compra só pode ser atribuída a administradores gerais (role=admin, especialidade=geral). % tem role=% e especialidade=%.',
      v_novo_nome, v_novo_role, v_novo_especialidade;
  END IF;

  -- Lê estado atual (pode ser NULL se fornecedor ainda não mapeado)
  SELECT c.administrador_id, a.nome, c.fornecedor_nome
  INTO v_anterior_id, v_anterior_nome, v_fornecedor_nome
  FROM public.pedidos_compra_carteira_fornecedor c
  JOIN public.administradores a ON a.id = c.administrador_id
  WHERE c.fornecedor_codigo = v_codigo AND c.ativo = true;

  IF v_fornecedor_nome IS NULL THEN
    RAISE EXCEPTION 'Fornecedor % não está mapeado na carteira de Pedidos de Compra.', v_codigo;
  END IF;

  -- UPSERT do vínculo — apenas troca o dono daqui pra frente, não toca em pedidos_compra
  UPDATE public.pedidos_compra_carteira_fornecedor
  SET administrador_id = p_novo_admin_id,
      updated_at       = now(),
      updated_by       = p_gestor_id
  WHERE fornecedor_codigo = v_codigo;

  -- Auditoria
  INSERT INTO public.pedidos_compra_carteira_fornecedor_audit (
    fornecedor_codigo,
    fornecedor_nome,
    admin_anterior_id,
    admin_anterior_nome,
    admin_novo_id,
    admin_novo_nome,
    motivo,
    alterado_por,
    alterado_em
  ) VALUES (
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome,
    p_motivo,
    p_gestor_id,
    now()
  );

  RETURN QUERY SELECT
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome;
END;
$$;

COMMENT ON FUNCTION public.realocar_carteira_fornecedor_pedidos IS
  'Troca o responsável de um fornecedor na carteira de Pedidos de Compra e grava auditoria. Requer gestor. NÃO reatribui pedidos_compra existentes — só muda o dono a partir de agora.';

-- ============================================================
-- 2) Seed dos 8 fornecedores mapeados
-- ============================================================
DO $$
DECLARE
  v_paula   UUID;
  v_mayky   UUID;
  v_rosana  UUID;
  v_fabiola UUID;
  v_wander  UUID;
  v_walter  UUID;
BEGIN
  SELECT id INTO v_paula   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_mayky   FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_rosana  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_wander  FROM public.administradores WHERE email = 'wanderluciomendes@bemol.com.br';
  SELECT id INTO v_walter  FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';

  IF v_paula   IS NULL THEN RAISE EXCEPTION 'Admin Paula não encontrada';   END IF;
  IF v_mayky   IS NULL THEN RAISE EXCEPTION 'Admin Mayky não encontrado';   END IF;
  IF v_rosana  IS NULL THEN RAISE EXCEPTION 'Admin Rosana não encontrada';  END IF;
  IF v_fabiola IS NULL THEN RAISE EXCEPTION 'Admin Fabíola não encontrada'; END IF;
  IF v_wander  IS NULL THEN RAISE EXCEPTION 'Admin Wanderlucio não encontrado'; END IF;
  IF v_walter  IS NULL THEN RAISE EXCEPTION 'Admin Walter (autor do seed) não encontrado'; END IF;

  INSERT INTO public.pedidos_compra_carteira_fornecedor
    (fornecedor_codigo, fornecedor_nome, administrador_id, created_by, updated_by)
  VALUES
    -- Paula: maior volume (NDS) + menor (Marcones), pra equilibrar
    ('10079', 'NDS',             v_paula,   v_walter, v_walter),
    ('16977', 'MARCONES',        v_paula,   v_walter, v_walter),

    -- Mayky: segundo maior volume isolado (Brasferro)
    ('1441',  'BRASFERRO',       v_mayky,   v_walter, v_walter),

    -- Fabíola: Reforma Rápida + Lusivan
    ('8141',  'REFORMA RAPIDA',  v_fabiola, v_walter, v_walter),
    ('10171', 'LUSIVAN',         v_fabiola, v_walter, v_walter),

    -- Rosana: Sep Instalações + Renê
    ('13166', 'SEP INSTALACOES', v_rosana,  v_walter, v_walter),
    ('16472', 'RENE',            v_rosana,  v_walter, v_walter),

    -- Wanderlucio: Rio Negro
    ('16883', 'RIO NEGRO',       v_wander,  v_walter, v_walter)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        fornecedor_nome  = EXCLUDED.fornecedor_nome,
        updated_at       = now(),
        updated_by       = EXCLUDED.updated_by;

  RAISE NOTICE 'Seed: 8 fornecedores da carteira de Pedidos de Compra inseridos/atualizados.';
END;
$$;
