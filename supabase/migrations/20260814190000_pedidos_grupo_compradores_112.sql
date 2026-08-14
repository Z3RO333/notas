-- Canonical purchase-orders contract for purchasing group 112.
--
-- The previous ingestion selected documents by mapped SAP creator and therefore
-- mixed purchasing groups. This migration is additive: it keeps legacy columns
-- and RPC signatures while introducing source provenance, a canonical view and
-- snapshot finalization guarded by source counts.

ALTER TABLE public.pedidos_compra
  ADD COLUMN IF NOT EXISTS grupo_compradores varchar(10),
  ADD COLUMN IF NOT EXISTS organizacao_compras varchar(10),
  ADD COLUMN IF NOT EXISTS status_proc_raw varchar(20),
  ADD COLUMN IF NOT EXISTS data_criacao date,
  ADD COLUMN IF NOT EXISTS criador_admin_id uuid REFERENCES public.administradores(id),
  ADD COLUMN IF NOT EXISTS source_bk_extracao text,
  ADD COLUMN IF NOT EXISTS source_data_extracao date,
  ADD COLUMN IF NOT EXISTS source_sync_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_active boolean NOT NULL DEFAULT false;

ALTER TABLE public.pedidos_compra_itens
  ADD COLUMN IF NOT EXISTS ultima_modificacao_source date,
  ADD COLUMN IF NOT EXISTS source_bk_extracao text,
  ADD COLUMN IF NOT EXISTS source_mes_extracao varchar(6),
  ADD COLUMN IF NOT EXISTS source_data_extracao date,
  ADD COLUMN IF NOT EXISTS source_sync_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_active boolean NOT NULL DEFAULT false;

-- A carga escreve primeiro nestas tabelas sem afetar o snapshot publicado.
-- A funcao de finalizacao valida e promove o run inteiro em uma transacao.
CREATE TABLE IF NOT EXISTS public.pedidos_compra_112_staging (
  source_sync_run_id uuid NOT NULL,
  documento_compras varchar(20) NOT NULL,
  administrador_id uuid,
  criador_admin_id uuid,
  sap_codigo varchar(20) NOT NULL,
  fornecedor varchar(20),
  grupo_compradores varchar(10),
  organizacao_compras varchar(10),
  status_proc_raw varchar(20),
  data_criacao date,
  data_documento date,
  valor_liquido_total numeric(18, 2),
  status public.pedido_compra_status NOT NULL,
  tipo_documento varchar(10),
  mes_extracao varchar(6) NOT NULL,
  source_bk_extracao text,
  source_data_extracao date,
  source_last_seen_at timestamptz NOT NULL,
  source_active boolean NOT NULL DEFAULT false,
  staged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_sync_run_id, documento_compras)
);

CREATE TABLE IF NOT EXISTS public.pedidos_compra_itens_112_staging (
  source_sync_run_id uuid NOT NULL,
  documento_compras varchar(20) NOT NULL,
  item_numero varchar(10) NOT NULL,
  descricao text,
  codigo_material varchar(20),
  grupo_mercadoria varchar(20),
  quantidade numeric(18, 3),
  unidade_medida varchar(10),
  preco_unitario numeric(18, 2),
  valor_liquido numeric(18, 2),
  centro varchar(10),
  requisicao_compra varchar(20),
  excluido boolean NOT NULL DEFAULT false,
  ultima_modificacao_source date,
  source_bk_extracao text,
  source_mes_extracao varchar(6),
  source_data_extracao date,
  source_last_seen_at timestamptz NOT NULL,
  source_active boolean NOT NULL DEFAULT false,
  staged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_sync_run_id, documento_compras, item_numero)
);

ALTER TABLE public.pedidos_compra_112_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_compra_itens_112_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pedidos_compra_112_staging FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pedidos_compra_itens_112_staging FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pedidos_compra_112_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pedidos_compra_itens_112_staging TO service_role;

COMMENT ON COLUMN public.pedidos_compra.grupo_compradores IS
  'EKGRP/GRUPO_COMPRADORES da fonte Databricks. O workspace de Pedidos usa exclusivamente o grupo 112.';
COMMENT ON COLUMN public.pedidos_compra.administrador_id IS
  'Responsavel operacional atual. Nao e necessariamente o criador SAP nem o dono da carteira do fornecedor.';
COMMENT ON COLUMN public.pedidos_compra.criador_admin_id IS
  'Administrador resolvido a partir de CRIADO_POR/sap_user_admin_map; pode ser NULL sem excluir o pedido do grupo 112.';
COMMENT ON COLUMN public.pedidos_compra.source_active IS
  'True quando o documento pertence ao ultimo snapshot completo e validado do grupo comprador 112.';

CREATE INDEX IF NOT EXISTS pedidos_compra_112_active_document_date_idx
  ON public.pedidos_compra (data_documento DESC, id DESC)
  WHERE source_active = true AND grupo_compradores = '112';

CREATE INDEX IF NOT EXISTS pedidos_compra_112_active_owner_date_idx
  ON public.pedidos_compra (administrador_id, data_documento DESC, id DESC)
  WHERE source_active = true AND grupo_compradores = '112';

CREATE INDEX IF NOT EXISTS pedidos_compra_112_source_run_idx
  ON public.pedidos_compra (source_sync_run_id)
  WHERE grupo_compradores = '112';

CREATE INDEX IF NOT EXISTS pedidos_compra_itens_source_run_idx
  ON public.pedidos_compra_itens (source_sync_run_id);

CREATE INDEX IF NOT EXISTS pedidos_compra_itens_active_doc_excluido_idx
  ON public.pedidos_compra_itens (documento_compras, excluido)
  INCLUDE (valor_liquido)
  WHERE source_active = true;

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
  'grupo_112'::text AS scope_quality,
  CASE
    WHEN p.status_proc_raw IS NULL OR p.status_proc_raw NOT IN ('02', '03', '05') THEN 'status_desconhecido'
    WHEN p.status_proc_raw = '02' AND COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens'
    ELSE 'ok'
  END::text AS status_quality,
  CASE WHEN COALESCE(s.itens_total, 0) = 0 THEN 'sem_itens' ELSE 'ok' END::text AS items_quality
FROM public.pedidos_compra p
LEFT JOIN item_stats s ON s.documento_compras = p.documento_compras
WHERE p.source_active = true
  AND regexp_replace(btrim(COALESCE(p.grupo_compradores, '')), '^0+', '') = '112';

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
  v_headers_inactivated integer := 0;
  v_items_inactivated integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(112112);

  IF p_sync_run_id IS NULL OR p_expected_headers IS NULL OR p_expected_headers <= 0
     OR p_expected_items IS NULL OR p_expected_items <= 0 THEN
    RAISE EXCEPTION 'Snapshot 112 invalido: run/counts ausentes ou vazios';
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
    RAISE EXCEPTION 'Snapshot 112 incompleto: esperado headers/items %/%, recebido %/%',
      p_expected_headers, p_expected_items, v_headers, v_items;
  END IF;

  IF v_headers < 30000 OR v_items < 50000 THEN
    RAISE EXCEPTION 'Snapshot 112 abaixo do piso de seguranca: headers/items %/%', v_headers, v_items;
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

  IF v_current_headers > 0
     AND (v_headers < floor(v_current_headers * 0.80) OR v_headers > ceil(v_current_headers * 1.20)) THEN
    RAISE EXCEPTION 'Snapshot 112 fora da variacao segura: atual/novo %/%', v_current_headers, v_headers;
  END IF;

  IF v_current_items > 0
     AND (v_items < floor(v_current_items * 0.80) OR v_items > ceil(v_current_items * 1.20)) THEN
    RAISE EXCEPTION 'Itens do snapshot 112 fora da variacao segura: atual/novo %/%', v_current_items, v_items;
  END IF;

  SELECT MAX(source_last_seen_at) INTO v_new_seen_at
  FROM public.pedidos_compra_112_staging
  WHERE source_sync_run_id = p_sync_run_id;

  SELECT MAX(source_last_seen_at) INTO v_current_seen_at
  FROM public.pedidos_compra
  WHERE source_active = true
    AND regexp_replace(btrim(COALESCE(grupo_compradores, '')), '^0+', '') = '112';

  IF v_current_seen_at IS NOT NULL AND (v_new_seen_at IS NULL OR v_new_seen_at <= v_current_seen_at) THEN
    RAISE EXCEPTION 'Snapshot 112 antigo rejeitado: atual/novo %/%', v_current_seen_at, v_new_seen_at;
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
    'finalized_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalizar_snapshot_pedidos_compra_112(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_snapshot_pedidos_compra_112(uuid, integer, integer) TO service_role;

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
       AND p.status_proc_raw = '02'
       AND s.total_itens > 0
       AND s.itens_ativos = 0
    RETURNING p.documento_compras
  )
  SELECT COUNT(*) INTO affected FROM upd;

  RETURN COALESCE(affected, 0);
END;
$function$;

DROP FUNCTION IF EXISTS public.buscar_pedidos_workspace(uuid, uuid, text, text, text, text, date, uuid, integer, boolean);
DROP FUNCTION IF EXISTS public.filtrar_pedidos_workspace_base(uuid, uuid, text, text, text, text, date, uuid, boolean);

CREATE OR REPLACE FUNCTION public.filtrar_pedidos_workspace_base(
  p_admin_scope uuid DEFAULT NULL,
  p_admin_filter uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_cursor_data_documento date DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_carteira_especial boolean DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  documento_compras varchar,
  administrador_id uuid,
  responsavel_atual_nome text,
  sap_codigo varchar,
  fornecedor varchar,
  fornecedor_codigo text,
  fornecedor_nome text,
  data_documento date,
  cursor_data_documento date,
  valor_liquido_total numeric,
  status public.pedido_compra_status,
  status_header text,
  status_proc_raw varchar,
  status_efetivo text,
  status_indeterminado boolean,
  tipo_documento varchar,
  grupo_compradores varchar,
  organizacao_compras varchar,
  data_criacao date,
  mes_extracao varchar,
  created_at timestamptz,
  updated_at timestamptz,
  nf_referencias text[],
  fornecedor_owner_admin_id uuid,
  fornecedor_owner_nome text,
  na_carteira_especial boolean,
  criador_admin_id uuid,
  criador_admin_nome text,
  itens_total integer,
  itens_ativos integer,
  itens_excluidos integer,
  valor_itens_total numeric,
  valor_itens_ativos numeric,
  valor_divergencia numeric,
  source_bk_extracao text,
  source_data_extracao date,
  source_last_seen_at timestamptz,
  source_active boolean,
  scope_quality text,
  status_quality text,
  items_quality text
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
      p_cursor_id AS cursor_id,
      p_carteira_especial AS carteira_especial_filter,
      '00000000-0000-0000-0000-000000000000'::uuid AS unassigned_id
  ),
  enriched AS (
    SELECT
      p.*,
      public.normalize_supplier_code(p.fornecedor) AS fornecedor_codigo,
      COALESCE(oper.nome, forn.nome) AS fornecedor_nome,
      COALESCE(p.data_documento, DATE '1900-01-01') AS cursor_data_documento,
      carteira.administrador_id AS fornecedor_owner_admin_id,
      owner_admin.nome AS fornecedor_owner_nome,
      (carteira.fornecedor_codigo IS NOT NULL) AS na_carteira_especial,
      creator.nome AS criador_admin_nome,
      responsible.nome AS responsavel_atual_nome
    FROM public.vw_pedidos_compra_112 p
    LEFT JOIN public.dim_operacionais oper
      ON public.normalize_supplier_code(oper.codigo) = public.normalize_supplier_code(p.fornecedor)
    LEFT JOIN public.dim_fornecedores forn
      ON public.normalize_supplier_code(forn.codigo) = public.normalize_supplier_code(p.fornecedor)
    LEFT JOIN public.pedidos_compra_carteira_fornecedor carteira
      ON carteira.fornecedor_codigo = public.normalize_supplier_code(p.fornecedor)
     AND carteira.ativo = true
    LEFT JOIN public.administradores owner_admin ON owner_admin.id = carteira.administrador_id
    LEFT JOIN public.administradores creator ON creator.id = p.criador_admin_id
    LEFT JOIN public.administradores responsible ON responsible.id = p.administrador_id
  )
  SELECT
    e.id,
    e.documento_compras,
    e.administrador_id,
    e.responsavel_atual_nome,
    e.sap_codigo,
    e.fornecedor,
    e.fornecedor_codigo,
    e.fornecedor_nome,
    e.data_documento,
    e.cursor_data_documento,
    e.valor_liquido_total,
    e.status,
    e.status_header,
    e.status_proc_raw,
    e.status_efetivo,
    e.status_indeterminado,
    e.tipo_documento,
    e.grupo_compradores,
    e.organizacao_compras,
    e.data_criacao,
    e.mes_extracao,
    e.created_at,
    e.updated_at,
    e.nf_referencias,
    e.fornecedor_owner_admin_id,
    e.fornecedor_owner_nome,
    e.na_carteira_especial,
    e.criador_admin_id,
    e.criador_admin_nome,
    e.itens_total,
    e.itens_ativos,
    e.itens_excluidos,
    e.valor_itens_total,
    e.valor_itens_ativos,
    e.valor_divergencia,
    e.source_bk_extracao,
    e.source_data_extracao,
    e.source_last_seen_at,
    e.source_active,
    e.scope_quality,
    e.status_quality,
    e.items_quality
  FROM enriched e
  CROSS JOIN params prm
  WHERE
    (prm.admin_scope IS NULL OR e.administrador_id = prm.admin_scope)
    AND (
      prm.admin_scope IS NOT NULL
      OR prm.admin_filter IS NULL
      OR (prm.admin_filter = prm.unassigned_id AND e.administrador_id IS NULL)
      OR (prm.admin_filter <> prm.unassigned_id AND e.administrador_id = prm.admin_filter)
    )
    AND (prm.status_filter IS NULL OR prm.status_filter = 'all' OR e.status_efetivo = prm.status_filter)
    AND (
      prm.ano_filter IS NULL OR prm.ano_filter = 'all'
      OR to_char(e.data_documento, 'YYYY') = prm.ano_filter
    )
    AND (
      prm.mes_filter IS NULL OR prm.mes_filter = 'all'
      OR to_char(e.data_documento, 'YYYYMM') = prm.mes_filter
    )
    AND (
      prm.cursor_id IS NULL OR prm.cursor_date IS NULL
      OR e.cursor_data_documento < prm.cursor_date
      OR (e.cursor_data_documento = prm.cursor_date AND e.id < prm.cursor_id)
    )
    AND (
      prm.q_filter IS NULL
      OR e.documento_compras ILIKE ('%' || prm.q_filter || '%')
      OR COALESCE(e.tipo_documento, '') ILIKE ('%' || prm.q_filter || '%')
      OR COALESCE(e.sap_codigo, '') ILIKE ('%' || prm.q_filter || '%')
      OR COALESCE(e.fornecedor_codigo, '') ILIKE ('%' || prm.q_filter || '%')
      OR COALESCE(e.fornecedor_nome, '') ILIKE ('%' || prm.q_filter || '%')
    )
    AND (
      prm.carteira_especial_filter IS NULL
      OR prm.carteira_especial_filter = false
      OR e.na_carteira_especial = true
    );
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
  p_limit integer DEFAULT 100,
  p_carteira_especial boolean DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  documento_compras varchar,
  administrador_id uuid,
  responsavel_atual_nome text,
  sap_codigo varchar,
  fornecedor varchar,
  fornecedor_codigo text,
  fornecedor_nome text,
  data_documento date,
  cursor_data_documento date,
  valor_liquido_total numeric,
  status public.pedido_compra_status,
  status_header text,
  status_proc_raw varchar,
  status_efetivo text,
  status_indeterminado boolean,
  tipo_documento varchar,
  grupo_compradores varchar,
  organizacao_compras varchar,
  data_criacao date,
  mes_extracao varchar,
  created_at timestamptz,
  updated_at timestamptz,
  nf_referencias text[],
  fornecedor_owner_admin_id uuid,
  fornecedor_owner_nome text,
  na_carteira_especial boolean,
  criador_admin_id uuid,
  criador_admin_nome text,
  itens_total integer,
  itens_ativos integer,
  itens_excluidos integer,
  valor_itens_total numeric,
  valor_itens_ativos numeric,
  valor_divergencia numeric,
  source_bk_extracao text,
  source_data_extracao date,
  source_last_seen_at timestamptz,
  source_active boolean,
  scope_quality text,
  status_quality text,
  items_quality text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT *
  FROM public.filtrar_pedidos_workspace_base(
    p_admin_scope, p_admin_filter, p_status, p_ano, p_mes_extracao, p_q,
    p_cursor_data_documento, p_cursor_id, p_carteira_especial
  ) b
  ORDER BY b.cursor_data_documento DESC, b.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
$function$;

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
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_pedidos_workspace_base(
      p_admin_scope, p_admin_filter, p_status, p_ano, p_mes_extracao, p_q,
      NULL, NULL, NULL
    )
  )
  SELECT json_build_object(
    'total', COUNT(*)::integer,
    'em_aberto', COUNT(*) FILTER (WHERE status_efetivo = 'em_aberto')::integer,
    'encerrado', COUNT(*) FILTER (WHERE status_efetivo = 'encerrado')::integer,
    'cancelado', COUNT(*) FILTER (WHERE status_efetivo = 'cancelado')::integer,
    'status_indeterminado', COUNT(*) FILTER (WHERE status_efetivo = 'indeterminado')::integer,
    'valor_total', COALESCE(SUM(valor_liquido_total), 0),
    'valor_em_aberto', COALESCE(SUM(valor_itens_ativos) FILTER (WHERE status_efetivo = 'em_aberto'), 0),
    'valor_itens_ativos', COALESCE(SUM(valor_itens_ativos), 0),
    'fornecedores_em_aberto', COUNT(DISTINCT fornecedor_codigo) FILTER (WHERE status_efetivo = 'em_aberto')::integer,
    'abertos_mais_30_dias', COUNT(*) FILTER (
      WHERE status_efetivo = 'em_aberto' AND data_documento < current_date - 30
    )::integer,
    'abertos_mais_90_dias', COUNT(*) FILTER (
      WHERE status_efetivo = 'em_aberto' AND data_documento < current_date - 90
    )::integer,
    'sem_responsavel', COUNT(*) FILTER (WHERE administrador_id IS NULL)::integer,
    'sem_itens', COUNT(*) FILTER (WHERE itens_total = 0)::integer,
    'sem_criador_mapeado', COUNT(*) FILTER (WHERE criador_admin_id IS NULL)::integer,
    'status_desconhecido', COUNT(*) FILTER (
      WHERE status_proc_raw IS NULL OR status_proc_raw NOT IN ('02', '03', '05')
    )::integer,
    'ultima_atualizacao', MAX(source_data_extracao)
  )
  FROM filtered;
$function$;

DROP FUNCTION IF EXISTS public.listar_pedidos_summary_por_admin(uuid, text, text, text, text);

CREATE FUNCTION public.listar_pedidos_summary_por_admin(
  p_admin_scope uuid DEFAULT NULL,
  p_ano text DEFAULT NULL,
  p_mes_extracao text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE(
  admin_id uuid,
  nome text,
  avatar_url text,
  especialidade text,
  em_aberto bigint,
  encerrado bigint,
  cancelado bigint,
  valor_total numeric,
  status_indeterminado bigint,
  valor_em_aberto numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_pedidos_workspace_base(
      p_admin_scope, NULL, p_status, p_ano, p_mes_extracao, p_q,
      NULL, NULL, NULL
    )
  )
  SELECT
    f.administrador_id AS admin_id,
    COALESCE(a.nome, 'Sem responsavel')::text AS nome,
    a.avatar_url,
    a.especialidade::text,
    COUNT(*) FILTER (WHERE f.status_efetivo = 'em_aberto') AS em_aberto,
    COUNT(*) FILTER (WHERE f.status_efetivo = 'encerrado') AS encerrado,
    COUNT(*) FILTER (WHERE f.status_efetivo = 'cancelado') AS cancelado,
    COALESCE(SUM(f.valor_liquido_total), 0) AS valor_total,
    COUNT(*) FILTER (WHERE f.status_efetivo = 'indeterminado') AS status_indeterminado,
    COALESCE(SUM(f.valor_itens_ativos) FILTER (WHERE f.status_efetivo = 'em_aberto'), 0) AS valor_em_aberto
  FROM filtered f
  LEFT JOIN public.administradores a ON a.id = f.administrador_id
  GROUP BY f.administrador_id, a.nome, a.avatar_url, a.especialidade
  ORDER BY
    COUNT(*) FILTER (WHERE f.status_efetivo = 'em_aberto') DESC,
    COALESCE(SUM(f.valor_itens_ativos) FILTER (WHERE f.status_efetivo = 'em_aberto'), 0) DESC,
    COALESCE(a.nome, 'Sem responsavel');
$function$;

REVOKE ALL ON FUNCTION public.listar_pedidos_summary_por_admin(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_summary_por_admin(uuid, text, text, text, text) TO service_role;

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
  WHERE p.data_documento BETWEEN DATE '2000-01-01' AND (current_date + INTERVAL '1 year')::date
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
  WHERE p.data_documento BETWEEN DATE '2000-01-01' AND (current_date + INTERVAL '1 year')::date
    AND (p_admin_scope IS NULL OR p.administrador_id = p_admin_scope)
    AND (
      p_admin_scope IS NOT NULL OR p_admin_filter IS NULL
      OR (p_admin_filter = '00000000-0000-0000-0000-000000000000'::uuid AND p.administrador_id IS NULL)
      OR p.administrador_id = p_admin_filter
    )
    AND (p_ano IS NULL OR p_ano = 'all' OR to_char(p.data_documento, 'YYYY') = p_ano)
  ORDER BY mes_extracao DESC;
$function$;

CREATE OR REPLACE VIEW public.vw_pedidos_carteira_fornecedor_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id AS admin_id,
  a.nome AS admin_nome,
  a.avatar_url AS admin_avatar,
  count(p.id)::integer AS qtd_pedidos,
  count(p.id) FILTER (WHERE p.status_efetivo = 'em_aberto')::integer AS em_aberto,
  count(p.id) FILTER (WHERE p.status_efetivo = 'encerrado')::integer AS encerrado,
  count(p.id) FILTER (WHERE p.status_efetivo = 'cancelado')::integer AS cancelado,
  COALESCE(sum(p.valor_liquido_total), 0::numeric) AS valor_total,
  c.tipo_carteira,
  array_remove(
    array_agg(p.documento_compras ORDER BY p.documento_compras)
      FILTER (WHERE p.is_contrato_anual = true),
    NULL::character varying
  ) AS documentos_compras,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'numero', p.documento_compras,
        'ciclo', p.ciclo,
        'admin_id', pa.id,
        'admin_nome', pa.nome,
        'admin_avatar', pa.avatar_url
      ) ORDER BY p.documento_compras
    ) FILTER (WHERE p.is_contrato_anual = true AND p.documento_compras IS NOT NULL),
    '[]'::jsonb
  ) AS pedidos_contratos
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.vw_pedidos_compra_112 p
  ON public.normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
 AND (
   (c.tipo_carteira = 'preventiva_anual' AND p.is_contrato_anual = true)
   OR (c.tipo_carteira = 'corretiva' AND COALESCE(p.is_contrato_anual, false) = false)
 )
LEFT JOIN public.administradores pa ON pa.id = p.administrador_id
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY COALESCE(sum(p.valor_liquido_total), 0::numeric) DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.listar_pedidos_carteira_fornecedor_resumo(
  p_admin_scope uuid DEFAULT NULL,
  p_tipo text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_codigo text,
  fornecedor_nome text,
  admin_id uuid,
  admin_nome text,
  admin_avatar text,
  qtd_pedidos integer,
  em_aberto integer,
  encerrado integer,
  cancelado integer,
  valor_total numeric,
  tipo_carteira text,
  documentos_compras varchar[],
  pedidos_contratos jsonb
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT
    c.fornecedor_codigo::text,
    c.fornecedor_nome::text,
    a.id,
    a.nome::text,
    a.avatar_url::text,
    count(p.id)::integer,
    count(p.id) FILTER (WHERE p.status_efetivo = 'em_aberto')::integer,
    count(p.id) FILTER (WHERE p.status_efetivo = 'encerrado')::integer,
    count(p.id) FILTER (WHERE p.status_efetivo = 'cancelado')::integer,
    COALESCE(sum(p.valor_liquido_total), 0::numeric),
    c.tipo_carteira::text,
    array_remove(
      array_agg(p.documento_compras ORDER BY p.documento_compras)
        FILTER (WHERE p.is_contrato_anual = true),
      NULL::character varying
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'numero', p.documento_compras,
          'ciclo', p.ciclo,
          'admin_id', pa.id,
          'admin_nome', pa.nome,
          'admin_avatar', pa.avatar_url
        ) ORDER BY p.documento_compras
      ) FILTER (WHERE p.is_contrato_anual = true AND p.documento_compras IS NOT NULL),
      '[]'::jsonb
    )
  FROM public.pedidos_compra_carteira_fornecedor c
  JOIN public.administradores a ON a.id = c.administrador_id
  LEFT JOIN public.vw_pedidos_compra_112 p
    ON public.normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
   AND (
     (c.tipo_carteira = 'preventiva_anual' AND p.is_contrato_anual = true)
     OR (c.tipo_carteira = 'corretiva' AND COALESCE(p.is_contrato_anual, false) = false)
   )
   AND (p_admin_scope IS NULL OR p.administrador_id = p_admin_scope)
  LEFT JOIN public.administradores pa ON pa.id = p.administrador_id
  WHERE c.ativo = true
    AND (p_tipo IS NULL OR c.tipo_carteira::text = p_tipo)
  GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
  HAVING p_admin_scope IS NULL OR count(p.id) > 0
  ORDER BY COALESCE(sum(p.valor_liquido_total), 0::numeric) DESC NULLS LAST;
$function$;

REVOKE ALL ON TABLE public.vw_pedidos_compra_112 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vw_pedidos_carteira_fornecedor_resumo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_pedidos_compra_112 TO service_role;
GRANT SELECT ON TABLE public.vw_pedidos_carteira_fornecedor_resumo TO service_role;

REVOKE ALL ON FUNCTION public.recompute_pedidos_compra_status_for(varchar[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.filtrar_pedidos_workspace_base(uuid, uuid, text, text, text, text, date, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buscar_pedidos_workspace(uuid, uuid, text, text, text, text, date, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcular_kpis_pedidos_workspace(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_pedidos_workspace_anos(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_pedidos_workspace_meses(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_pedidos_carteira_fornecedor_resumo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_pedidos_compra_status_for(varchar[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.filtrar_pedidos_workspace_base(uuid, uuid, text, text, text, text, date, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.buscar_pedidos_workspace(uuid, uuid, text, text, text, text, date, uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcular_kpis_pedidos_workspace(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_workspace_anos(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_workspace_meses(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_carteira_fornecedor_resumo(uuid, text) TO service_role;
