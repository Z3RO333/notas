-- 00320_pneu_sempre_cd_manaus.sql
-- Compra de pneu/roda de tração deve sempre ir para o responsável de CD (Brenda),
-- independente da unidade (loja comum ou outro CD), não só CD Manaus.

INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit) VALUES
  ('PNEU', 'cd_manaus', false),
  ('RODA DE TRAÇÃO', 'cd_manaus', false);

-- resolve_admin_ordem_sem_nota() so tratava explicitamente 'refrigeracao' e
-- 'elevadores' no match por palavra-chave; qualquer outra especialidade
-- (ex: cd_manaus vindo da regra acima) caia direto no fallback geral, porque
-- o bloco B (CD fixo por unidade) só assume cd_manaus quando a unidade
-- contém "MANAUS". Adiciona um branch para cd_manaus vindo de palavra-chave
-- valer independente da unidade.
CREATE OR REPLACE FUNCTION public.resolve_admin_ordem_sem_nota(p_centro text, p_unidade text DEFAULT NULL::text, p_descricao text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unidade        TEXT;
  v_admin          UUID;
  v_keyword_esp    TEXT;
  v_eh_movimentacao BOOLEAN;
  v_centro_manaus  BOOLEAN;
BEGIN
  -- Resolve unidade
  v_unidade := COALESCE(p_unidade, (
    SELECT d.unidade FROM public.dim_centro_unidade d WHERE d.centro = p_centro LIMIT 1
  ));

  v_centro_manaus := COALESCE(v_unidade ILIKE '%MANAUS%', false)
                     OR COALESCE(p_centro = '104', false);

  -- ─────────────────────────────────────────────────────────────────────────
  -- A. Match por palavra-chave (keyword mais longa)
  -- ─────────────────────────────────────────────────────────────────────────
  IF p_descricao IS NOT NULL AND BTRIM(p_descricao) <> '' THEN
    SELECT r.especialidade
      INTO v_keyword_esp
    FROM public.regras_distribuicao r
    WHERE UPPER(p_descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    -- Regras 'excluir' (FROTAS, MECÂNICA, RECAPAGEM, BORRACHARIA, SUSPENSÃO,
    -- BAÚ, PREVENTIVA DE 1.500 HORAS...): ordem não deve ter dono nem entrar
    -- no cockpit. Simétrico ao pula_cockpit de distribuir_notas.
    IF v_keyword_esp = 'excluir' THEN
      RETURN NULL;
    END IF;

    -- Downgrade elevadores -> geral para MONTA CARGA / PLATAFORMA / EMPILHADEIRA
    -- (Gustavo nao recebe mais essas)
    IF v_keyword_esp = 'elevadores' THEN
      v_eh_movimentacao := COALESCE(p_descricao, '') ~* '(MONTA[\s\-]*CARGA|PLATAFORMA|EMPILHADEIRA)';
      IF v_eh_movimentacao THEN
        v_keyword_esp := NULL;
      END IF;
    END IF;

    -- Override CD 104 + equipamento -> Daniel
    IF v_centro_manaus AND public.is_cd_manaus_equipamento(p_descricao) THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'cd_manaus_equip'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;

    -- CD Manaus via palavra-chave direta (ex: PNEU, RODA DE TRAÇÃO): vale em
    -- qualquer unidade, não só quando o centro já é Manaus.
    IF v_keyword_esp = 'cd_manaus' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'cd_manaus'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;

    -- Refrigeracao
    IF v_keyword_esp = 'refrigeracao' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'refrigeracao'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;

    -- Elevadores (apos downgrade): ELEVADOR / ESCADA ROLANTE / GERADOR / SUBESTACAO
    IF v_keyword_esp = 'elevadores' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'elevadores'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- B. CD fixo por unidade (Brenda CD Manaus / Adriano CD Taruma)
  -- ─────────────────────────────────────────────────────────────────────────
  IF v_unidade IS NOT NULL THEN
    SELECT a.id INTO v_admin
    FROM public.administradores a
    WHERE a.ativo = true
      AND a.em_ferias = false
      AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
           OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      AND (
        (a.especialidade = 'cd_taruma' AND (v_unidade ILIKE '%TURISMO%' OR v_unidade ILIKE '%TARUMA%'))
        OR
        (a.especialidade = 'cd_manaus' AND v_unidade ILIKE '%MANAUS%')
      )
    ORDER BY a.nome ASC
    LIMIT 1;
  END IF;

  -- CD Porto Velho → sem dono
  IF v_admin IS NULL AND v_unidade = 'CD PORTO VELHO' THEN
    RETURN NULL;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- C. Fallback geral
  -- ─────────────────────────────────────────────────────────────────────────
  IF v_admin IS NULL THEN
    v_admin := public.pick_fallback_admin_for_order(p_centro);
  END IF;

  RETURN v_admin;
END;
$function$;

-- Corrige as duas ordens já detectadas com a regra antiga (5230849 e 5231129)
DO $$
DECLARE
  v_brenda_id UUID;
BEGIN
  SELECT id INTO v_brenda_id
  FROM public.administradores
  WHERE especialidade = 'cd_manaus' AND ativo = true
  ORDER BY nome ASC
  LIMIT 1;

  IF v_brenda_id IS NOT NULL THEN
    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_brenda_id, updated_at = now()
    WHERE ordem_codigo IN ('5230849', '5231129');
  END IF;
END $$;
