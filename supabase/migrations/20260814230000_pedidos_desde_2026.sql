-- Limita o workspace e o snapshot de Pedidos ao grupo comprador 112 com
-- DATA_DOCUMENTO entre 2026-01-01 e a data corrente.

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
    WHEN p.status_proc_raw = '03' THEN 'cancelado'
    WHEN p.status_proc_raw = '05' THEN 'encerrado'
    WHEN p.status_proc_raw = '02' AND COALESCE(s.itens_total, 0) = 0 THEN 'indeterminado'
    WHEN p.status_proc_raw = '02' AND COALESCE(s.itens_ativos, 0) = 0 THEN 'encerrado'
    WHEN p.status_proc_raw = '02' THEN 'em_aberto'
    ELSE 'indeterminado'
  END::text AS status_efetivo,
  (
    p.status_proc_raw IS NULL
    OR p.status_proc_raw NOT IN ('02', '03', '05')
    OR (p.status_proc_raw = '02' AND COALESCE(s.itens_total, 0) = 0)
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
    WHEN p.status_proc_raw IS NULL OR p.status_proc_raw NOT IN ('02', '03', '05') THEN 'status_desconhecido'
    WHEN p.status_proc_raw = '02' AND COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens'
    ELSE 'ok'
  END::text AS status_quality,
  CASE WHEN COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens' ELSE 'ok' END::text AS items_quality
FROM public.pedidos_compra p
LEFT JOIN item_stats s ON s.documento_compras = p.documento_compras
WHERE p.source_active = true
  AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112'
  AND p.data_documento >= DATE '2026-01-01'
  AND p.data_documento <= current_date;

CREATE OR REPLACE FUNCTION public.finalizar_snapshot_pedidos_compra_112(
  p_sync_run_id uuid,
  p_expected_headers integer,
  p_expected_items integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $function$
DECLARE
  v_headers integer;
  v_items integer;
  v_current_headers integer;
  v_current_items integer;
  v_new_seen_at timestamptz;
  v_current_seen_at timestamptz;
  v_cutover_from_history boolean;
  v_headers_inactivated integer := 0;
  v_items_inactivated integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(112112);

  IF p_sync_run_id IS NULL OR p_expected_headers IS NULL OR p_expected_headers <= 0
     OR p_expected_items IS NULL OR p_expected_items <= 0 THEN
    RAISE EXCEPTION 'Snapshot 112/2026 invalido: run/counts ausentes ou vazios';
  END IF;

  SELECT COUNT(*)::integer INTO v_headers
  FROM public.pedidos_compra_112_staging p
  WHERE p.source_sync_run_id = p_sync_run_id
    AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112';

  SELECT COUNT(*)::integer INTO v_items
  FROM public.pedidos_compra_itens_112_staging i
  JOIN public.pedidos_compra_112_staging p
    ON p.source_sync_run_id = i.source_sync_run_id
   AND p.documento_compras = i.documento_compras
  WHERE i.source_sync_run_id = p_sync_run_id
    AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112';

  IF v_headers <> p_expected_headers OR v_items <> p_expected_items THEN
    RAISE EXCEPTION 'Snapshot 112/2026 incompleto: esperado headers/items %/%, recebido %/%',
      p_expected_headers, p_expected_items, v_headers, v_items;
  END IF;

  IF v_headers < 1000 OR v_items < 1000 THEN
    RAISE EXCEPTION 'Snapshot 112/2026 abaixo do piso de seguranca: headers/items %/%', v_headers, v_items;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pedidos_compra_112_staging s
    WHERE s.source_sync_run_id = p_sync_run_id
      AND (
        s.data_documento IS NULL
        OR s.data_documento < DATE '2026-01-01'
        OR s.data_documento > current_date
      )
  ) THEN
    RAISE EXCEPTION 'Snapshot 112 contem DATA_DOCUMENTO fora do recorte desde 2026';
  END IF;

  SELECT COUNT(*)::integer INTO v_current_headers
  FROM public.pedidos_compra p
  WHERE p.source_active = true
    AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112';

  SELECT COUNT(*)::integer INTO v_current_items
  FROM public.pedidos_compra_itens i
  JOIN public.pedidos_compra p ON p.documento_compras = i.documento_compras
  WHERE i.source_active = true
    AND p.source_active = true
    AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112';

  SELECT EXISTS (
    SELECT 1
    FROM public.pedidos_compra p
    WHERE p.source_active = true
      AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112'
      AND (
        p.data_documento IS NULL
        OR p.data_documento < DATE '2026-01-01'
        OR p.data_documento > current_date
      )
  ) INTO v_cutover_from_history;

  IF NOT v_cutover_from_history AND v_current_headers > 0
     AND (v_headers < floor(v_current_headers * 0.80) OR v_headers > ceil(v_current_headers * 1.20)) THEN
    RAISE EXCEPTION 'Snapshot 112/2026 fora da variacao segura: atual/novo %/%', v_current_headers, v_headers;
  END IF;

  IF NOT v_cutover_from_history AND v_current_items > 0
     AND (v_items < floor(v_current_items * 0.80) OR v_items > ceil(v_current_items * 1.20)) THEN
    RAISE EXCEPTION 'Itens do snapshot 112/2026 fora da variacao segura: atual/novo %/%', v_current_items, v_items;
  END IF;

  SELECT MAX(source_last_seen_at) INTO v_new_seen_at
  FROM public.pedidos_compra_112_staging
  WHERE source_sync_run_id = p_sync_run_id;

  SELECT MAX(source_last_seen_at) INTO v_current_seen_at
  FROM public.pedidos_compra
  WHERE source_active = true
    AND regexp_replace(btrim(COALESCE(grupo_compradores, '')), '^0+', '') = '112';

  IF v_current_seen_at IS NOT NULL AND (v_new_seen_at IS NULL OR v_new_seen_at <= v_current_seen_at) THEN
    RAISE EXCEPTION 'Snapshot 112/2026 antigo rejeitado: atual/novo %/%', v_current_seen_at, v_new_seen_at;
  END IF;

  INSERT INTO public.pedidos_compra (
    documento_compras, administrador_id, criador_admin_id, sap_codigo, fornecedor,
    grupo_compradores, organizacao_compras, status_proc_raw, data_criacao,
    data_documento, valor_liquido_total, status, tipo_documento, mes_extracao,
    source_bk_extracao, source_data_extracao, source_sync_run_id,
    source_last_seen_at, source_active, updated_at
  )
  SELECT
    s.documento_compras, s.administrador_id, s.criador_admin_id, s.sap_codigo, s.fornecedor,
    s.grupo_compradores, s.organizacao_compras, s.status_proc_raw, s.data_criacao,
    s.data_documento, s.valor_liquido_total, s.status, s.tipo_documento, s.mes_extracao,
    s.source_bk_extracao, s.source_data_extracao, s.source_sync_run_id,
    s.source_last_seen_at, true, now()
  FROM public.pedidos_compra_112_staging s
  WHERE s.source_sync_run_id = p_sync_run_id
  ON CONFLICT (documento_compras) DO UPDATE SET
    criador_admin_id = EXCLUDED.criador_admin_id,
    sap_codigo = EXCLUDED.sap_codigo,
    fornecedor = EXCLUDED.fornecedor,
    grupo_compradores = EXCLUDED.grupo_compradores,
    organizacao_compras = EXCLUDED.organizacao_compras,
    status_proc_raw = EXCLUDED.status_proc_raw,
    data_criacao = EXCLUDED.data_criacao,
    data_documento = EXCLUDED.data_documento,
    valor_liquido_total = EXCLUDED.valor_liquido_total,
    status = EXCLUDED.status,
    tipo_documento = EXCLUDED.tipo_documento,
    mes_extracao = EXCLUDED.mes_extracao,
    source_bk_extracao = EXCLUDED.source_bk_extracao,
    source_data_extracao = EXCLUDED.source_data_extracao,
    source_sync_run_id = EXCLUDED.source_sync_run_id,
    source_last_seen_at = EXCLUDED.source_last_seen_at,
    source_active = true,
    updated_at = now();

  INSERT INTO public.pedidos_compra_itens (
    documento_compras, item_numero, descricao, codigo_material, grupo_mercadoria,
    quantidade, unidade_medida, preco_unitario, valor_liquido, centro,
    requisicao_compra, excluido, ultima_modificacao_source, source_bk_extracao,
    source_mes_extracao, source_data_extracao, source_sync_run_id,
    source_last_seen_at, source_active
  )
  SELECT
    s.documento_compras, s.item_numero, s.descricao, s.codigo_material, s.grupo_mercadoria,
    s.quantidade, s.unidade_medida, s.preco_unitario, s.valor_liquido, s.centro,
    s.requisicao_compra, s.excluido, s.ultima_modificacao_source, s.source_bk_extracao,
    s.source_mes_extracao, s.source_data_extracao, s.source_sync_run_id,
    s.source_last_seen_at, true
  FROM public.pedidos_compra_itens_112_staging s
  WHERE s.source_sync_run_id = p_sync_run_id
  ON CONFLICT (documento_compras, item_numero) DO UPDATE SET
    descricao = EXCLUDED.descricao,
    codigo_material = EXCLUDED.codigo_material,
    grupo_mercadoria = EXCLUDED.grupo_mercadoria,
    quantidade = EXCLUDED.quantidade,
    unidade_medida = EXCLUDED.unidade_medida,
    preco_unitario = EXCLUDED.preco_unitario,
    valor_liquido = EXCLUDED.valor_liquido,
    centro = EXCLUDED.centro,
    requisicao_compra = EXCLUDED.requisicao_compra,
    excluido = EXCLUDED.excluido,
    ultima_modificacao_source = EXCLUDED.ultima_modificacao_source,
    source_bk_extracao = EXCLUDED.source_bk_extracao,
    source_mes_extracao = EXCLUDED.source_mes_extracao,
    source_data_extracao = EXCLUDED.source_data_extracao,
    source_sync_run_id = EXCLUDED.source_sync_run_id,
    source_last_seen_at = EXCLUDED.source_last_seen_at,
    source_active = true;

  UPDATE public.pedidos_compra p
     SET source_active = false,
         updated_at = now()
   WHERE regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112'
     AND p.source_active = true
     AND p.source_sync_run_id IS DISTINCT FROM p_sync_run_id;
  GET DIAGNOSTICS v_headers_inactivated = ROW_COUNT;

  UPDATE public.pedidos_compra_itens i
     SET source_active = false
   WHERE i.source_active = true
     AND i.source_sync_run_id IS DISTINCT FROM p_sync_run_id
     AND EXISTS (
       SELECT 1
       FROM public.pedidos_compra p
       WHERE p.documento_compras = i.documento_compras
         AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112'
     );
  GET DIAGNOSTICS v_items_inactivated = ROW_COUNT;

  DELETE FROM public.pedidos_compra_112_staging
  WHERE source_sync_run_id = p_sync_run_id OR staged_at < now() - INTERVAL '7 days';
  DELETE FROM public.pedidos_compra_itens_112_staging
  WHERE source_sync_run_id = p_sync_run_id OR staged_at < now() - INTERVAL '7 days';

  RETURN json_build_object(
    'sync_run_id', p_sync_run_id,
    'headers', v_headers,
    'items', v_items,
    'headers_inactivated', v_headers_inactivated,
    'items_inactivated', v_items_inactivated,
    'cutover_from_history', v_cutover_from_history,
    'period_start', DATE '2026-01-01',
    'period_end', current_date,
    'finalized_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.listar_pedidos_workspace_anos(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL
)
RETURNS TABLE(ano text)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT DISTINCT to_char(p.data_documento, 'YYYY') AS ano
  FROM public.vw_pedidos_compra_112 p
  WHERE p.data_documento >= DATE '2026-01-01'
    AND p.data_documento <= current_date
    AND (p_admin_scope IS NULL OR p.administrador_id = p_admin_scope)
    AND (
      p_admin_scope IS NOT NULL OR p_admin_filter IS NULL
      OR (p_admin_filter = '00000000-0000-0000-0000-000000000000'::uuid AND p.administrador_id IS NULL)
      OR p.administrador_id = p_admin_filter
    )
  ORDER BY ano DESC;
$function$;

CREATE OR REPLACE FUNCTION public.listar_pedidos_workspace_meses(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL,
  p_ano text DEFAULT NULL
)
RETURNS TABLE(mes_extracao text)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT DISTINCT to_char(p.data_documento, 'YYYYMM') AS mes_extracao
  FROM public.vw_pedidos_compra_112 p
  WHERE p.data_documento >= DATE '2026-01-01'
    AND p.data_documento <= current_date
    AND (p_admin_scope IS NULL OR p.administrador_id = p_admin_scope)
    AND (
      p_admin_scope IS NOT NULL OR p_admin_filter IS NULL
      OR (p_admin_filter = '00000000-0000-0000-0000-000000000000'::uuid AND p.administrador_id IS NULL)
      OR p.administrador_id = p_admin_filter
    )
    AND (p_ano IS NULL OR p_ano = 'all' OR to_char(p.data_documento, 'YYYY') = p_ano)
  ORDER BY mes_extracao DESC;
$function$;

REVOKE ALL ON FUNCTION public.finalizar_snapshot_pedidos_compra_112(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_pedidos_workspace_anos(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_pedidos_workspace_meses(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_snapshot_pedidos_compra_112(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_workspace_anos(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_workspace_meses(uuid, uuid, text) TO service_role;
