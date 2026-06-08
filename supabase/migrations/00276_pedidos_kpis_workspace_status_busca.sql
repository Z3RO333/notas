-- Adiciona filtros de status e busca textual ao calculo de KPIs do workspace de pedidos,
-- para que os totais reflitam os mesmos filtros globais aplicados na listagem.
CREATE OR REPLACE FUNCTION public.calcular_kpis_pedidos_workspace(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH params AS (
    SELECT
      p_admin_scope AS admin_scope,
      p_admin_filter AS admin_filter,
      NULLIF(BTRIM(p_ano), '') AS ano_filter,
      NULLIF(BTRIM(p_mes_extracao), '') AS mes_filter,
      NULLIF(BTRIM(p_status), '') AS status_filter,
      NULLIF(BTRIM(p_q), '') AS q_filter
  ),
  filtered AS (
    SELECT
      p.status,
      p.valor_liquido_total,
      public.normalize_supplier_code(p.fornecedor) AS fornecedor_codigo,
      p.documento_compras,
      p.tipo_documento,
      p.sap_codigo
    FROM public.pedidos_compra p
    CROSS JOIN params prm
    WHERE
      (prm.admin_scope IS NULL OR p.administrador_id = prm.admin_scope)
      AND (
        prm.admin_scope IS NOT NULL
        OR prm.admin_filter IS NULL
        OR p.administrador_id = prm.admin_filter
      )
      AND (
        prm.ano_filter IS NULL
        OR prm.ano_filter = 'all'
        OR p.mes_extracao BETWEEN (prm.ano_filter || '01') AND (prm.ano_filter || '12')
      )
      AND (
        prm.mes_filter IS NULL
        OR prm.mes_filter = 'all'
        OR p.mes_extracao = prm.mes_filter
      )
      AND (
        prm.status_filter IS NULL
        OR prm.status_filter = 'all'
        OR p.status::text = prm.status_filter
      )
  ),
  enriched AS (
    SELECT
      f.*,
      COALESCE(oper.nome, forn.nome) AS fornecedor_nome
    FROM filtered f
    LEFT JOIN public.dim_operacionais oper
      ON public.normalize_supplier_code(oper.codigo) = f.fornecedor_codigo
    LEFT JOIN public.dim_fornecedores forn
      ON public.normalize_supplier_code(forn.codigo) = f.fornecedor_codigo
  )
  SELECT json_build_object(
    'total', COUNT(*)::integer,
    'em_aberto', COUNT(*) FILTER (WHERE e.status = 'em_aberto')::integer,
    'encerrado', COUNT(*) FILTER (WHERE e.status = 'encerrado')::integer,
    'cancelado', COUNT(*) FILTER (WHERE e.status = 'cancelado')::integer,
    'valor_total', COALESCE(SUM(e.valor_liquido_total), 0)
  )
  FROM enriched e
  CROSS JOIN params prm
  WHERE
    prm.q_filter IS NULL
    OR e.documento_compras ILIKE ('%' || prm.q_filter || '%')
    OR COALESCE(e.tipo_documento, '') ILIKE ('%' || prm.q_filter || '%')
    OR COALESCE(e.sap_codigo, '') ILIKE ('%' || prm.q_filter || '%')
    OR COALESCE(e.fornecedor_codigo, '') ILIKE ('%' || prm.q_filter || '%')
    OR COALESCE(e.fornecedor_nome, '') ILIKE ('%' || prm.q_filter || '%');
$function$;
