-- 00327_resolve_admin_ordem_sem_nota_criticos.sql
--
-- Adiciona branch 'criticos' (Gestão de Incêndio) em resolve_admin_ordem_sem_nota().
-- Essa função resolve o dono de ordens que chegam do SAP sem nota correspondente
-- (nota_id IS NULL). Já tratava 'cd_manaus', 'refrigeracao' e 'elevadores' via
-- palavra-chave, mas nunca ganhou um branch para 'criticos' (extintor/alarme de
-- incêndio/hidrante/mangueira) — essas ordens caíam no fallback geral em vez de
-- ir para o especialista de incêndio, mesmo com a especialidade já existindo
-- (achado ao revisar o fluxo nota→ordem da migration 00323).

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

    -- Criticos (Gestão de Incêndio): EXTINTOR, ALARME DE INCÊNDIO, HIDRANTE,
    -- MANGUEIRA (contexto incêndio), BOMBA/CENTRAL/PROJETO/COMBATE A INCÊNDIO
    IF v_keyword_esp = 'criticos' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'criticos'
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
