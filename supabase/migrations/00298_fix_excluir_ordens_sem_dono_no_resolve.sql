-- 00298_fix_excluir_ordens_sem_dono_no_resolve.sql
--
-- Causa raiz (confirmada em produção): resolve_admin_ordem_sem_nota() (00248)
-- nunca checa regras_distribuicao.especialidade='excluir' (FROTAS, MECÂNICA,
-- RECAPAGEM, BORRACHARIA, SUSPENSÃO, BAÚ, PREVENTIVA DE 1.500 HORAS...).
--
-- Fluxo do bug:
--   1. Nota chega com descricao "MECÂNICA - FROTAS" -> casa regra 'excluir'.
--   2. distribuir_notas() nunca processa essa nota porque o pedido já tem
--      ordem no mesmo sync (o NOT EXISTS de ordens_notas_acompanhamento falha)
--      -> nota.administrador_id fica NULL para sempre, exclui_cockpit nunca
--      chega a ser setado (só é setado dentro de distribuir_notas ou pelos
--      backfills pontuais 00238/00285/00287, que rodam uma vez só e não
--      cobrem notas futuras).
--   3. registrar_ordens_por_notas() cria a ordem e, como a nota não tem admin,
--      chama resolve_admin_ordem_sem_nota(centro, unidade, descricao) — essa
--      função só sabe sobre refrigeracao/elevadores/cd_manaus_equip, ignora
--      'excluir' e cai no fallback geral -> atribui a ordem a um admin do
--      pool geral (Rosana, Paula, etc.).
--
-- Resultado: ordens de frota/mecânica aparecem no workspace/cockpit dos
-- administradores gerais mesmo com a regra de exclusão configurada
-- corretamente em regras_distribuicao.
--
-- Correção:
--   1. resolve_admin_ordem_sem_nota: checa 'excluir' ANTES de qualquer
--      fallback e retorna NULL (ordem sem dono) quando casar — simétrico ao
--      pula_cockpit de distribuir_notas.
--   2. Backfill notas_manutencao: corrige exclui_cockpit/administrador_id
--      para notas 'excluir' que escaparam do backfill original.
--   3. Backfill ordens_notas_acompanhamento: limpa administrador_id e
--      criado_por das ordens vinculadas a notas 'excluir' — nenhuma migration
--      anterior (00238/00285/00286/00287) tocava essa tabela.

-- ============================================================
-- 1. resolve_admin_ordem_sem_nota: checa 'excluir' primeiro
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_admin_ordem_sem_nota(
  p_centro    TEXT,
  p_unidade   TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

COMMENT ON FUNCTION public.resolve_admin_ordem_sem_nota(TEXT, TEXT, TEXT) IS
  'Resolve admin para ordens sem responsavel: excluir (sem dono) -> keyword (refrigeracao/elevadores/cd_manaus_equip) -> CD fixo -> fallback geral. Simetrico a distribuir_notas. Atualizado em 00298.';

-- ============================================================
-- 2. Backfill notas_manutencao: corrige exclui_cockpit/administrador_id
--    para notas 'excluir' que escaparam do backfill original (criadas
--    após 00238/00285/00287 ou nunca reavaliadas)
-- ============================================================
UPDATE public.notas_manutencao n
SET exclui_cockpit   = true,
    administrador_id = NULL,
    updated_at       = now()
WHERE n.exclui_cockpit = false
  AND EXISTS (
    SELECT 1 FROM public.regras_distribuicao r
    WHERE r.especialidade = 'excluir'
      AND UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  );

DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao WHERE exclui_cockpit = true
);

-- ============================================================
-- 3. Backfill ordens_notas_acompanhamento: limpa administrador_id e
--    criado_por das ordens vinculadas a notas 'excluir' — nenhuma migration
--    anterior tocava essa tabela, por isso a ordem continuava aparecendo no
--    workspace do admin herdado antes da regra de exclusão existir.
-- ============================================================
UPDATE public.ordens_notas_acompanhamento o
SET administrador_id = NULL,
    criado_por        = NULL,
    updated_at        = now()
FROM public.notas_manutencao n
WHERE o.nota_id = n.id
  AND n.exclui_cockpit = true
  AND (o.administrador_id IS NOT NULL OR o.criado_por IS NOT NULL);
