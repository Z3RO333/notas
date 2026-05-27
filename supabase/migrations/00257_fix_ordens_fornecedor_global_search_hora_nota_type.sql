-- 00257_fix_ordens_fornecedor_global_search_hora_nota_type.sql
--
-- Corrige o tipo de retorno de hora_nota no localizador global por fornecedor.
-- vw_ordens_notas_painel expõe hora_nota como TEXT, não TIMESTAMPTZ.

DROP FUNCTION IF EXISTS public.buscar_ordens_fornecedor_global(TEXT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.buscar_ordens_fornecedor_global(
  p_q TEXT,
  p_admin_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  ordem_id UUID,
  nota_id UUID,
  numero_nota TEXT,
  ordem_codigo TEXT,
  administrador_id UUID,
  administrador_nome TEXT,
  responsavel_atual_id UUID,
  responsavel_atual_nome TEXT,
  centro TEXT,
  unidade TEXT,
  status_ordem TEXT,
  status_ordem_raw TEXT,
  ordem_detectada_em TIMESTAMPTZ,
  status_atualizado_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  qtd_historico BIGINT,
  tem_historico BOOLEAN,
  dias_em_aberto INTEGER,
  semaforo_atraso TEXT,
  envolvidos_admin_ids UUID[],
  descricao TEXT,
  tipo_ordem TEXT,
  hora_nota TEXT,
  fornecedor_codigo TEXT,
  fornecedor_nome TEXT,
  data_entrada TIMESTAMPTZ,
  texto_breve TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role public.user_role;
  v_q TEXT := BTRIM(COALESCE(p_q, ''));
  v_probe TEXT;
  v_like TEXT;
  v_like_unaccent TEXT;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_result_count INTEGER := 0;
BEGIN
  SELECT a.role
    INTO v_admin_role
  FROM public.administradores a
  WHERE a.id = p_admin_id
    AND a.auth_user_id = auth.uid()
    AND a.ativo = true
    AND a.role IN ('admin'::public.user_role, 'gestor'::public.user_role)
  LIMIT 1;

  IF v_admin_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao para localizar ordens por fornecedor'
      USING ERRCODE = '42501';
  END IF;

  v_probe := regexp_replace(v_q, '[\s%_\\]+', '', 'g');
  IF length(v_probe) < 3 THEN
    RAISE EXCEPTION 'Informe pelo menos 3 caracteres para buscar fornecedor'
      USING ERRCODE = '22023';
  END IF;

  v_like := '%' ||
    replace(
      replace(
        replace(v_q, E'\\', E'\\\\'),
        '%',
        E'\\%'
      ),
      '_',
      E'\\_'
    ) ||
    '%';
  v_like_unaccent := public.unaccent(v_like);

  RETURN QUERY
  WITH matched AS (
    SELECT
      v.ordem_id,
      v.nota_id,
      v.numero_nota,
      v.ordem_codigo,
      v.administrador_id,
      v.administrador_nome,
      v.responsavel_atual_id,
      v.responsavel_atual_nome,
      v.centro,
      v.unidade,
      v.status_ordem::TEXT,
      v.status_ordem_raw,
      v.ordem_detectada_em,
      v.status_atualizado_em,
      v.dias_para_gerar_ordem,
      v.qtd_historico,
      v.tem_historico,
      v.dias_em_aberto,
      v.semaforo_atraso::TEXT,
      v.envolvidos_admin_ids,
      v.descricao,
      v.tipo_ordem,
      v.hora_nota,
      NULLIF(BTRIM(o.fornecedor_codigo), '') AS fornecedor_codigo,
      COALESCE(df.nome, NULLIF(BTRIM(o.fornecedor_nome), ''), NULLIF(BTRIM(o.fornecedor_codigo), '')) AS fornecedor_nome,
      v.ordem_detectada_em AS data_entrada,
      v.descricao AS texto_breve
    FROM public.vw_ordens_notas_painel v
    JOIN public.ordens_notas_acompanhamento o
      ON o.id = v.ordem_id
    LEFT JOIN public.dim_fornecedores df
      ON public.normalize_supplier_code(df.codigo) = public.normalize_supplier_code(o.fornecedor_codigo)
    WHERE o.fornecedor_codigo ILIKE v_like ESCAPE '\'
       OR o.fornecedor_nome ILIKE v_like ESCAPE '\'
       OR df.nome ILIKE v_like ESCAPE '\'
       OR public.unaccent(COALESCE(o.fornecedor_nome, '')) ILIKE v_like_unaccent ESCAPE '\'
       OR public.unaccent(COALESCE(df.nome, '')) ILIKE v_like_unaccent ESCAPE '\'
    ORDER BY
      CASE WHEN public.status_raw_eh_final(v.status_ordem_raw) THEN 1 ELSE 0 END,
      v.ordem_detectada_em DESC,
      v.ordem_codigo
    LIMIT v_limit
  )
  SELECT * FROM matched;

  GET DIAGNOSTICS v_result_count = ROW_COUNT;

  INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
  VALUES (
    p_admin_id,
    'buscar_ordens_fornecedor_global',
    NULL,
    jsonb_build_object(
      'termo', v_q,
      'limite', v_limit,
      'qtd_resultados', v_result_count,
      'role', v_admin_role
    )
  );
END;
$$;

COMMENT ON FUNCTION public.buscar_ordens_fornecedor_global(TEXT, UUID, INTEGER) IS
  'Busca global controlada e auditada de ordens por fornecedor. Ancora elegibilidade na vw_ordens_notas_painel e nao altera o workspace normal.';

REVOKE ALL ON FUNCTION public.buscar_ordens_fornecedor_global(TEXT, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_ordens_fornecedor_global(TEXT, UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
