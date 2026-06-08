-- Adiciona filtros globais (ano, mes, status, busca) ao resumo de pedidos por colaborador,
-- para que a tabela "Pedidos por Colaborador" reflita os mesmos filtros da barra global.
CREATE OR REPLACE FUNCTION listar_pedidos_summary_por_admin(
  p_admin_scope uuid DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE (
  admin_id      uuid,
  nome          text,
  avatar_url    text,
  especialidade text,
  em_aberto     bigint,
  encerrado     bigint,
  cancelado     bigint,
  valor_total   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      NULLIF(BTRIM(p_ano), '') AS ano_filter,
      NULLIF(BTRIM(p_mes_extracao), '') AS mes_filter,
      NULLIF(BTRIM(p_status), '') AS status_filter,
      NULLIF(BTRIM(p_q), '') AS q_filter
  ),
  pedidos_filtrados AS (
    SELECT
      pc.administrador_id,
      pc.status,
      pc.valor_liquido_total
    FROM pedidos_compra pc
    LEFT JOIN public.dim_operacionais oper
      ON public.normalize_supplier_code(oper.codigo) = public.normalize_supplier_code(pc.fornecedor)
    LEFT JOIN public.dim_fornecedores forn
      ON public.normalize_supplier_code(forn.codigo) = public.normalize_supplier_code(pc.fornecedor)
    CROSS JOIN params prm
    WHERE
      (
        prm.ano_filter IS NULL
        OR prm.ano_filter = 'all'
        OR pc.mes_extracao BETWEEN (prm.ano_filter || '01') AND (prm.ano_filter || '12')
      )
      AND (
        prm.mes_filter IS NULL
        OR prm.mes_filter = 'all'
        OR pc.mes_extracao = prm.mes_filter
      )
      AND (
        prm.status_filter IS NULL
        OR prm.status_filter = 'all'
        OR pc.status::text = prm.status_filter
      )
      AND (
        prm.q_filter IS NULL
        OR pc.documento_compras ILIKE ('%' || prm.q_filter || '%')
        OR COALESCE(pc.tipo_documento, '') ILIKE ('%' || prm.q_filter || '%')
        OR COALESCE(pc.sap_codigo, '') ILIKE ('%' || prm.q_filter || '%')
        OR COALESCE(public.normalize_supplier_code(pc.fornecedor), '') ILIKE ('%' || prm.q_filter || '%')
        OR COALESCE(oper.nome, forn.nome, '') ILIKE ('%' || prm.q_filter || '%')
      )
  )
  SELECT
    a.id                                                                    AS admin_id,
    a.nome,
    a.avatar_url,
    a.especialidade::text,
    COUNT(*) FILTER (WHERE pf.status = 'em_aberto')                        AS em_aberto,
    COUNT(*) FILTER (WHERE pf.status = 'encerrado')                        AS encerrado,
    COUNT(*) FILTER (WHERE pf.status = 'cancelado')                        AS cancelado,
    COALESCE(SUM(pf.valor_liquido_total) FILTER (WHERE pf.valor_liquido_total IS NOT NULL), 0) AS valor_total
  FROM administradores a
  LEFT JOIN pedidos_filtrados pf ON pf.administrador_id = a.id
  WHERE a.ativo = true
    AND a.recebe_distribuicao = true
    AND (p_admin_scope IS NULL OR a.id = p_admin_scope)
  GROUP BY a.id, a.nome, a.avatar_url, a.especialidade
  ORDER BY a.nome;
$$;
