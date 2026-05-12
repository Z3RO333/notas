-- 00249_pedidos_compra_item_excluido.sql
-- Adiciona indicador de exclusao por item nos pedidos de compra.
--
-- Origem: Databricks manutencao.silver.itens_documento_compras coluna CODIGO_DE_ELIMINACAO.
--   NULL    -> item ativo
--   'L'/'S'/'X' -> item marcado para exclusao (LOEKZ canonico do SAP)
--
-- Regra de negocio:
--   Quando todos os itens de um pedido estao com CODIGO_DE_ELIMINACAO IS NOT NULL,
--   o pedido nao deve mais aparecer como em_aberto no painel,
--   mesmo que o cabecalho ainda esteja com STATUS_PROC='02'.
--   O sync (jobs/sync-pedidos/sync_pedidos_to_supabase.py) reescreve o status
--   do cabecalho para 'encerrado' nesse caso.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Coluna excluido em pedidos_compra_itens
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos_compra_itens
  ADD COLUMN IF NOT EXISTS excluido boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pedidos_compra_itens_excluido_idx
  ON public.pedidos_compra_itens (documento_compras)
  WHERE excluido = false;

COMMENT ON COLUMN public.pedidos_compra_itens.excluido IS
  'true quando o item esta marcado para exclusao no SAP (CODIGO_DE_ELIMINACAO IS NOT NULL no Databricks).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Funcao auxiliar: recalcular status efetivo de um pedido
-- ─────────────────────────────────────────────────────────────────────────────
-- Regra:
--   - STATUS_PROC='03' (cancelado) e '05' (encerrado) sao do header SAP -> mantem
--   - STATUS_PROC='02' (em_aberto) com TODOS os itens excluidos -> reescreve para 'encerrado'
--   - Caso contrario -> mantem em_aberto
--
-- O sync ja escreve o status base. Esta funcao ajusta os pedidos que viram fantasmas
-- por exclusao total de itens. Util para backfills e para o proprio sync chamar
-- depois do upsert dos itens.

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
    GROUP BY i.documento_compras
  ),
  upd AS (
    UPDATE public.pedidos_compra p
       SET status = 'encerrado'::pedido_compra_status,
           updated_at = now()
      FROM stats s
     WHERE p.documento_compras = s.documento_compras
       AND p.status = 'em_aberto'::pedido_compra_status
       AND s.total_itens > 0
       AND s.itens_ativos = 0
    RETURNING p.documento_compras
  )
  SELECT COUNT(*) INTO affected FROM upd;

  RETURN COALESCE(affected, 0);
END;
$function$;

COMMENT ON FUNCTION public.recompute_pedidos_compra_status_for(varchar[]) IS
  'Reescreve para encerrado todo pedido com status em_aberto cujo conjunto de itens esteja inteiramente marcado para exclusao no SAP.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Backfill: aplica a regra para pedidos ja sincronizados
-- ─────────────────────────────────────────────────────────────────────────────
-- A coluna excluido foi acabada de criar (todos false). Os flags reais virao na
-- proxima execucao do sync. Para corrigir agora os 4 pedidos reportados pelo
-- usuario, marcamos os itens deles como excluidos com base no que foi observado
-- no Databricks (CODIGO_DE_ELIMINACAO='L' em todos os itens dos 4 documentos).

UPDATE public.pedidos_compra_itens
   SET excluido = true
 WHERE documento_compras IN (
   '4508532318',
   '4508537757',
   '4508540043',
   '4508735619'
 );

SELECT public.recompute_pedidos_compra_status_for(
  ARRAY['4508532318', '4508537757', '4508540043', '4508735619']::varchar[]
);
