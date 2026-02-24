-- 00071_notas_cockpit_convergencia.sql
-- Fonte única convergida para Painel de Notas/Cockpit.
-- Materializa elegibilidade operacional por NUMERO_NOTA.

-- ============================================================
-- 1) Tabela convergida
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notas_convergencia_cockpit (
  numero_nota TEXT PRIMARY KEY,
  numero_nota_norm TEXT NOT NULL,
  nota_id UUID REFERENCES public.notas_manutencao(id) ON DELETE SET NULL,
  ordem_sap TEXT,
  ordem_gerada TEXT,
  ordem_candidata TEXT,
  ordem_candidata_norm TEXT,
  status public.nota_status,
  descricao TEXT,
  centro TEXT,
  administrador_id UUID REFERENCES public.administradores(id),
  data_criacao_sap DATE,
  tem_qmel BOOLEAN NOT NULL DEFAULT false,
  tem_pmpl BOOLEAN NOT NULL DEFAULT false,
  tem_mestre BOOLEAN NOT NULL DEFAULT false,
  status_elegivel BOOLEAN NOT NULL DEFAULT false,
  tem_ordem_vinculada BOOLEAN NOT NULL DEFAULT false,
  eligible_cockpit BOOLEAN NOT NULL DEFAULT false,
  reason_not_eligible TEXT,
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  sync_id UUID REFERENCES public.sync_log(id) ON DELETE SET NULL,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notas_convergencia_cockpit_updated'
  ) THEN
    CREATE TRIGGER trg_notas_convergencia_cockpit_updated
      BEFORE UPDATE ON public.notas_convergencia_cockpit
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notas_convergencia_cockpit_numero_nota_norm
  ON public.notas_convergencia_cockpit (numero_nota_norm);

CREATE INDEX IF NOT EXISTS idx_notas_convergencia_cockpit_ordem_candidata_norm
  ON public.notas_convergencia_cockpit (ordem_candidata_norm);

CREATE INDEX IF NOT EXISTS idx_notas_convergencia_cockpit_eligible
  ON public.notas_convergencia_cockpit (eligible_cockpit);

CREATE INDEX IF NOT EXISTS idx_notas_convergencia_cockpit_admin_eligible
  ON public.notas_convergencia_cockpit (administrador_id, eligible_cockpit);

CREATE INDEX IF NOT EXISTS idx_notas_convergencia_cockpit_reason
  ON public.notas_convergencia_cockpit (reason_not_eligible);

COMMENT ON TABLE public.notas_convergencia_cockpit IS
  'Fonte convergida por numero_nota para elegibilidade do Cockpit (QMel + PMPL + Mestre + vínculo de ordem).';

COMMENT ON COLUMN public.notas_convergencia_cockpit.reason_not_eligible IS
  'Motivo principal de inelegibilidade conforme precedência operacional.';

COMMENT ON COLUMN public.notas_convergencia_cockpit.reason_codes IS
  'Lista completa de motivos aplicáveis de inelegibilidade.';

-- ============================================================
-- 2) View canônica do cockpit (somente elegíveis)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_cockpit_convergidas AS
SELECT
  c.nota_id AS id,
  c.numero_nota,
  c.numero_nota_norm,
  c.nota_id,
  c.ordem_sap,
  c.ordem_gerada,
  c.ordem_candidata,
  c.ordem_candidata_norm,
  c.status,
  c.descricao,
  c.centro,
  c.administrador_id,
  c.data_criacao_sap,
  c.tem_qmel,
  c.tem_pmpl,
  c.tem_mestre,
  c.status_elegivel,
  c.tem_ordem_vinculada,
  c.eligible_cockpit,
  c.reason_not_eligible,
  c.reason_codes,
  c.sync_id,
  c.source_updated_at,
  c.created_at,
  c.updated_at
FROM public.notas_convergencia_cockpit c
WHERE c.eligible_cockpit = true
ORDER BY c.data_criacao_sap ASC NULLS LAST, c.updated_at ASC;

-- ============================================================
-- 3) View de carga alinhada à mesma fonte elegível
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_administradores_cockpit_convergidas AS
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  COUNT(n.numero_nota) FILTER (WHERE n.status = 'nova') AS qtd_nova,
  COUNT(n.numero_nota) FILTER (WHERE n.status = 'em_andamento') AS qtd_em_andamento,
  COUNT(n.numero_nota) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
  COUNT(n.numero_nota) FILTER (WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas,
  COUNT(n.numero_nota) FILTER (WHERE n.status = 'concluida') AS qtd_concluidas,
  COUNT(n.numero_nota) FILTER (WHERE n.status = 'cancelada') AS qtd_canceladas,
  a.recebe_distribuicao,
  a.em_ferias
FROM public.administradores a
LEFT JOIN public.notas_convergencia_cockpit n
  ON n.administrador_id = a.id
 AND n.eligible_cockpit = true
WHERE a.role = 'admin'
GROUP BY
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  a.recebe_distribuicao,
  a.em_ferias;
