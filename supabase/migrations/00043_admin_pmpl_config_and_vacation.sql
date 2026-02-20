-- 00043_admin_pmpl_config_and_vacation.sql
-- Administração de responsável por tipo de ordem (PMPL/PMOS) + férias por período.

-- ============================================================
-- 1) FÉRIAS POR PERÍODO EM administradores
-- ============================================================
ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS data_inicio_ferias DATE,
  ADD COLUMN IF NOT EXISTS data_fim_ferias DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_administradores_intervalo_ferias'
      AND conrelid = 'public.administradores'::regclass
  ) THEN
    ALTER TABLE public.administradores
      ADD CONSTRAINT chk_administradores_intervalo_ferias
      CHECK (
        data_inicio_ferias IS NULL
        OR data_fim_ferias IS NULL
        OR data_fim_ferias >= data_inicio_ferias
      );
  END IF;
END
$$;

-- ============================================================
-- 2) RESPONSÁVEIS POR TIPO DE ORDEM
-- ============================================================
CREATE TABLE IF NOT EXISTS public.responsaveis_tipo_ordem (
  tipo_ordem TEXT PRIMARY KEY
    CHECK (tipo_ordem IN ('PMPL', 'PMOS')),
  responsavel_id UUID NOT NULL REFERENCES public.administradores(id) ON DELETE RESTRICT,
  substituto_id UUID REFERENCES public.administradores(id) ON DELETE SET NULL,
  atualizado_por UUID REFERENCES public.administradores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_responsavel_substituto_diferentes
    CHECK (substituto_id IS NULL OR substituto_id <> responsavel_id)
);

CREATE INDEX IF NOT EXISTS idx_responsaveis_tipo_ordem_responsavel
  ON public.responsaveis_tipo_ordem (responsavel_id);

CREATE INDEX IF NOT EXISTS idx_responsaveis_tipo_ordem_substituto
  ON public.responsaveis_tipo_ordem (substituto_id);

DROP TRIGGER IF EXISTS trg_responsaveis_tipo_ordem_updated ON public.responsaveis_tipo_ordem;
CREATE TRIGGER trg_responsaveis_tipo_ordem_updated
  BEFORE UPDATE ON public.responsaveis_tipo_ordem
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3) AUDITORIA DE CONFIGURAÇÃO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auditoria_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  antes JSONB,
  depois JSONB,
  atualizado_por UUID REFERENCES public.administradores(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_config_updated_at
  ON public.auditoria_config (updated_at DESC);

-- ============================================================
-- 4) RLS (somente tabelas novas)
-- ============================================================
ALTER TABLE public.responsaveis_tipo_ordem ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado lê responsaveis_tipo_ordem" ON public.responsaveis_tipo_ordem;
CREATE POLICY "Autenticado lê responsaveis_tipo_ordem"
  ON public.responsaveis_tipo_ordem
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gestor escreve responsaveis_tipo_ordem" ON public.responsaveis_tipo_ordem;
CREATE POLICY "Gestor escreve responsaveis_tipo_ordem"
  ON public.responsaveis_tipo_ordem
  FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'gestor')
  WITH CHECK (public.get_my_role() = 'gestor');

DROP POLICY IF EXISTS "Autenticado lê auditoria_config" ON public.auditoria_config;
CREATE POLICY "Autenticado lê auditoria_config"
  ON public.auditoria_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gestor escreve auditoria_config" ON public.auditoria_config;
CREATE POLICY "Gestor escreve auditoria_config"
  ON public.auditoria_config
  FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'gestor')
  WITH CHECK (public.get_my_role() = 'gestor');

-- ============================================================
-- 5) SEED INICIAL PMPL (idempotente)
-- ============================================================
INSERT INTO public.responsaveis_tipo_ordem (
  tipo_ordem,
  responsavel_id,
  substituto_id,
  atualizado_por
)
SELECT
  'PMPL',
  a.id,
  NULL,
  a.id
FROM public.administradores a
WHERE a.email = 'gustavoandrade@bemol.com.br'
ON CONFLICT (tipo_ordem) DO NOTHING;
