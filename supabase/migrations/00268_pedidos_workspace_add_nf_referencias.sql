-- 00268_pedidos_workspace_add_nf_referencias.sql
-- Adiciona nf_referencias (TEXT[]) ao retorno de filtrar_pedidos_workspace_base
-- e buscar_pedidos_workspace para expor os números de NF no painel.

DROP FUNCTION IF EXISTS public.buscar_pedidos_workspace(uuid, uuid, text, text, text, text, date, uuid, integer);
DROP FUNCTION IF EXISTS public.filtrar_pedidos_workspace_base(uuid, uuid, text, text, text, text, date, uuid);

CREATE OR REPLACE FUNCTION public.filtrar_pedidos_workspace_base(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_cursor_data_documento date DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  documento_compras varchar,
  administrador_id uuid,
  sap_codigo varchar,
  fornecedor varchar,
  fornecedor_codigo text,
  fornecedor_nome text,
  data_documento date,
  cursor_data_documento date,
  valor_liquido_total numeric,
  status public.pedido_compra_status,
  tipo_documento varchar,
  mes_extracao varchar,
  created_at timestamptz,
  updated_at timestamptz,
  nf_referencias text[]
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH params AS (
    SELECT
      p_admin_scope AS admin_scope,
      p_admin_filter AS admin_filter,
      NULLIF(BTRIM(p_status), '') AS status_filter,
      NULLIF(BTRIM(p_ano), '') AS ano_filter,
      NULLIF(BTRIM(p_mes_extracao), '') AS mes_filter,
      NULLIF(BTRIM(p_q), '') AS q_filter,
      p_cursor_data_documento AS cursor_date,
      p_cursor_id AS cursor_id
  ),
  filtered_base AS (
    SELECT
      p.id,
      p.documento_compras,
      p.administrador_id,
      p.sap_codigo,
      p.fornecedor,
      public.normalize_supplier_code(p.fornecedor) AS fornecedor_codigo,
      p.data_documento,
      COALESCE(p.data_documento, DATE '1900-01-01') AS cursor_data_documento,
      p.valor_liquido_total,
      p.status,
      p.tipo_documento,
      p.mes_extracao,
      p.created_at,
      p.updated_at,
      p.nf_referencias
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
        prm.status_filter IS NULL
        OR prm.status_filter = 'all'
        OR p.status::text = prm.status_filter
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
        prm.cursor_id IS NULL
        OR prm.cursor_date IS NULL
        OR COALESCE(p.data_documento, DATE '1900-01-01') < prm.cursor_date
        OR (
          COALESCE(p.data_documento, DATE '1900-01-01') = prm.cursor_date
          AND p.id < prm.cursor_id
        )
      )
  ),
  enriched AS (
    SELECT
      fb.id,
      fb.documento_compras,
      fb.administrador_id,
      fb.sap_codigo,
      fb.fornecedor,
      fb.fornecedor_codigo,
      COALESCE(oper.nome, forn.nome) AS fornecedor_nome,
      fb.data_documento,
      fb.cursor_data_documento,
      fb.valor_liquido_total,
      fb.status,
      fb.tipo_documento,
      fb.mes_extracao,
      fb.created_at,
      fb.updated_at,
      fb.nf_referencias
    FROM filtered_base fb
    LEFT JOIN public.dim_operacionais oper
      ON public.normalize_supplier_code(oper.codigo) = fb.fornecedor_codigo
    LEFT JOIN public.dim_fornecedores forn
      ON public.normalize_supplier_code(forn.codigo) = fb.fornecedor_codigo
  )
  SELECT
    e.id,
    e.documento_compras,
    e.administrador_id,
    e.sap_codigo,
    e.fornecedor,
    e.fornecedor_codigo,
    e.fornecedor_nome,
    e.data_documento,
    e.cursor_data_documento,
    e.valor_liquido_total,
    e.status,
    e.tipo_documento,
    e.mes_extracao,
    e.created_at,
    e.updated_at,
    e.nf_referencias
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

CREATE OR REPLACE FUNCTION public.buscar_pedidos_workspace(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_cursor_data_documento date DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  documento_compras varchar,
  administrador_id uuid,
  sap_codigo varchar,
  fornecedor varchar,
  fornecedor_codigo text,
  fornecedor_nome text,
  data_documento date,
  cursor_data_documento date,
  valor_liquido_total numeric,
  status public.pedido_compra_status,
  tipo_documento varchar,
  mes_extracao varchar,
  created_at timestamptz,
  updated_at timestamptz,
  nf_referencias text[]
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT
    b.id,
    b.documento_compras,
    b.administrador_id,
    b.sap_codigo,
    b.fornecedor,
    b.fornecedor_codigo,
    b.fornecedor_nome,
    b.data_documento,
    b.cursor_data_documento,
    b.valor_liquido_total,
    b.status,
    b.tipo_documento,
    b.mes_extracao,
    b.created_at,
    b.updated_at,
    b.nf_referencias
  FROM public.filtrar_pedidos_workspace_base(
    p_admin_scope => p_admin_scope,
    p_admin_filter => p_admin_filter,
    p_status => p_status,
    p_ano => p_ano,
    p_mes_extracao => p_mes_extracao,
    p_q => p_q,
    p_cursor_data_documento => p_cursor_data_documento,
    p_cursor_id => p_cursor_id
  ) AS b
  ORDER BY b.cursor_data_documento DESC, b.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
$function$;
