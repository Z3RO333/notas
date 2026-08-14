-- STATUS_PROC=03 representa liberacao concluida, nao cancelamento.
-- Cancelamento passa a vir do codigo de eliminacao do cabecalho, persistido
-- no enum legado pelo job; 02 e 03 permanecem abertos enquanto houver item ativo.

UPDATE public.pedidos_compra
SET status = 'em_aberto'::public.pedido_compra_status,
    updated_at = now()
WHERE source_active = true
  AND grupo_compradores = '112'
  AND status_proc_raw = '03'
  AND status = 'cancelado'::public.pedido_compra_status
  AND data_documento >= DATE '2026-01-01'
  AND data_documento <= current_date;

CREATE OR REPLACE VIEW public.vw_pedidos_compra_112 AS
WITH item_stats AS (
  SELECT
    i.documento_compras,
    COUNT(*)::integer AS itens_total,
    COUNT(*) FILTER (WHERE NOT i.excluido)::integer AS itens_ativos,
    COUNT(*) FILTER (WHERE i.excluido)::integer AS itens_excluidos,
    COALESCE(SUM(i.valor_liquido), 0::numeric) AS valor_itens_total,
    COALESCE(SUM(i.valor_liquido) FILTER (WHERE NOT i.excluido), 0::numeric) AS valor_itens_ativos,
    MAX(i.ultima_modificacao_source) AS ultima_modificacao_item
  FROM public.pedidos_compra_itens i
  WHERE i.source_active = true
  GROUP BY i.documento_compras
)
SELECT
  p.*,
  p.status::text AS status_header,
  CASE
    WHEN p.status = 'cancelado'::public.pedido_compra_status THEN 'cancelado'
    WHEN p.status_proc_raw = '05' THEN 'encerrado'
    WHEN p.status_proc_raw IN ('02', '03') AND COALESCE(s.itens_total, 0) = 0 THEN 'indeterminado'
    WHEN p.status_proc_raw IN ('02', '03') AND COALESCE(s.itens_ativos, 0) = 0 THEN 'encerrado'
    WHEN p.status_proc_raw IN ('02', '03') THEN 'em_aberto'
    ELSE 'indeterminado'
  END::text AS status_efetivo,
  (
    p.status <> 'cancelado'::public.pedido_compra_status
    AND (
      p.status_proc_raw IS NULL
      OR p.status_proc_raw NOT IN ('02', '03', '05')
      OR (p.status_proc_raw IN ('02', '03') AND COALESCE(s.itens_total, 0) = 0)
    )
  ) AS status_indeterminado,
  COALESCE(s.itens_total, 0)::integer AS itens_total,
  COALESCE(s.itens_ativos, 0)::integer AS itens_ativos,
  COALESCE(s.itens_excluidos, 0)::integer AS itens_excluidos,
  COALESCE(s.valor_itens_total, 0::numeric) AS valor_itens_total,
  COALESCE(s.valor_itens_ativos, 0::numeric) AS valor_itens_ativos,
  COALESCE(s.valor_itens_ativos, 0::numeric) - COALESCE(p.valor_liquido_total, 0::numeric) AS valor_divergencia,
  s.ultima_modificacao_item,
  'grupo_112_desde_2026'::text AS scope_quality,
  CASE
    WHEN p.status = 'cancelado'::public.pedido_compra_status THEN 'ok'
    WHEN p.status_proc_raw IS NULL OR p.status_proc_raw NOT IN ('02', '03', '05') THEN 'status_desconhecido'
    WHEN p.status_proc_raw IN ('02', '03') AND COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens'
    ELSE 'ok'
  END::text AS status_quality,
  CASE WHEN COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens' ELSE 'ok' END::text AS items_quality
FROM public.pedidos_compra p
LEFT JOIN item_stats s ON s.documento_compras = p.documento_compras
WHERE p.source_active = true
  AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112'
  AND p.data_documento >= DATE '2026-01-01'
  AND p.data_documento <= current_date;

CREATE OR REPLACE FUNCTION public.recompute_pedidos_compra_status_for(
  p_documentos varchar[]
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  affected integer;
BEGIN
  IF p_documentos IS NULL OR array_length(p_documentos, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH stats AS (
    SELECT
      i.documento_compras,
      COUNT(*) AS total_itens,
      COUNT(*) FILTER (WHERE NOT i.excluido) AS itens_ativos
    FROM public.pedidos_compra_itens i
    WHERE i.documento_compras = ANY(p_documentos)
      AND i.source_active = true
    GROUP BY i.documento_compras
  ),
  upd AS (
    UPDATE public.pedidos_compra p
       SET status = 'encerrado'::public.pedido_compra_status,
           updated_at = now()
      FROM stats s
     WHERE p.documento_compras = s.documento_compras
       AND p.source_active = true
       AND p.status_proc_raw IN ('02', '03')
       AND p.status <> 'cancelado'::public.pedido_compra_status
       AND s.total_itens > 0
       AND s.itens_ativos = 0
    RETURNING p.documento_compras
  )
  SELECT COUNT(*) INTO affected FROM upd;

  RETURN COALESCE(affected, 0);
END;
$function$;

REVOKE ALL ON TABLE public.vw_pedidos_compra_112 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_pedidos_compra_112 TO service_role;
REVOKE ALL ON FUNCTION public.recompute_pedidos_compra_status_for(varchar[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_pedidos_compra_status_for(varchar[]) TO service_role;
