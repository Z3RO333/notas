-- 00049_orders_tipo_documento_referencia.sql
-- Tabela de referência para tipo de documento de ordens (PMOS/PMPL)
-- proveniente de manutencao.silver.mestre_dados_ordem.

CREATE TABLE IF NOT EXISTS public.ordens_tipo_documento_referencia (
  ordem_codigo_norm TEXT PRIMARY KEY,
  ordem_codigo_original TEXT NOT NULL,
  tipo_documento_vendas TEXT NOT NULL CHECK (tipo_documento_vendas IN ('PMOS', 'PMPL')),
  fonte TEXT NOT NULL DEFAULT 'manutencao.silver.mestre_dados_ordem',
  last_sync_id UUID REFERENCES public.sync_log(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ordens_tipo_documento_referencia IS
  'Referência de tipo de ordem (PMOS/PMPL) por código normalizado, com ORDEM sem zeros à esquerda.';

COMMENT ON COLUMN public.ordens_tipo_documento_referencia.ordem_codigo_norm IS
  'Código da ordem normalizado (remove zeros à esquerda para chaves numéricas).';

COMMENT ON COLUMN public.ordens_tipo_documento_referencia.ordem_codigo_original IS
  'Valor original recebido na fonte mestre_dados_ordem.';

COMMENT ON COLUMN public.ordens_tipo_documento_referencia.tipo_documento_vendas IS
  'Tipo da ordem na fonte de referência (PMOS/PMPL).';

CREATE INDEX IF NOT EXISTS idx_ordens_tipo_doc_ref_tipo
  ON public.ordens_tipo_documento_referencia (tipo_documento_vendas);

CREATE INDEX IF NOT EXISTS idx_ordens_tipo_doc_ref_updated
  ON public.ordens_tipo_documento_referencia (updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_ordens_tipo_doc_ref_updated'
  ) THEN
    CREATE TRIGGER trg_ordens_tipo_doc_ref_updated
      BEFORE UPDATE ON public.ordens_tipo_documento_referencia
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.ordens_tipo_documento_referencia DISABLE ROW LEVEL SECURITY;
