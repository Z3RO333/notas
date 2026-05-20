-- 00253_pmpl_carteira_fornecedor.sql
--
-- Carteira PMPL por fornecedor.
-- Substitui o modelo de "um dono global PMPL" por vínculos fornecedor → administrador.
--
-- Cria:
--   1. pmpl_carteira_fornecedor  — vínculo ativo fornecedor_codigo → administrador_id
--   2. pmpl_carteira_audit       — histórico imutável de realocações
--   3. vw_pmpl_carteira_resumo   — view de leitura para a UI (sem joins no servidor)

-- ============================================================
-- 1) Tabela principal
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pmpl_carteira_fornecedor (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_codigo TEXT        NOT NULL,
  fornecedor_nome   TEXT,
  administrador_id  UUID        NOT NULL REFERENCES public.administradores(id),
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por        UUID        REFERENCES public.administradores(id),
  atualizado_por    UUID        REFERENCES public.administradores(id),

  CONSTRAINT uq_pmpl_carteira_fornecedor_codigo UNIQUE (fornecedor_codigo)
);

COMMENT ON TABLE public.pmpl_carteira_fornecedor IS
  'Vínculo fornecedor PMPL → administrador responsável. Um único responsável ativo por fornecedor.';

COMMENT ON COLUMN public.pmpl_carteira_fornecedor.fornecedor_codigo IS
  'Código SAP do fornecedor, normalizado: TRIM(UPPER(...)). Chave de lookup no routing.';

CREATE INDEX IF NOT EXISTS idx_pmpl_carteira_codigo
  ON public.pmpl_carteira_fornecedor(fornecedor_codigo);

CREATE INDEX IF NOT EXISTS idx_pmpl_carteira_admin
  ON public.pmpl_carteira_fornecedor(administrador_id);

-- ============================================================
-- 2) Tabela de auditoria
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pmpl_carteira_audit (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_codigo           TEXT        NOT NULL,
  fornecedor_nome             TEXT,
  admin_anterior_id           UUID        REFERENCES public.administradores(id),
  admin_anterior_nome         TEXT,
  admin_novo_id               UUID        NOT NULL REFERENCES public.administradores(id),
  admin_novo_nome             TEXT,
  qtd_ordens_abertas_afetadas INTEGER     NOT NULL DEFAULT 0,
  motivo                      TEXT,
  alterado_por                UUID        NOT NULL REFERENCES public.administradores(id),
  alterado_em                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pmpl_carteira_audit IS
  'Histórico imutável de realocações de carteira PMPL. Nomes denormalizados para preservar histórico.';

CREATE INDEX IF NOT EXISTS idx_pmpl_carteira_audit_fornecedor
  ON public.pmpl_carteira_audit(fornecedor_codigo);

CREATE INDEX IF NOT EXISTS idx_pmpl_carteira_audit_alterado_em
  ON public.pmpl_carteira_audit(alterado_em DESC);

-- ============================================================
-- 3) View de resumo para a UI
-- ============================================================
CREATE OR REPLACE VIEW public.vw_pmpl_carteira_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id         AS admin_id,
  a.nome       AS admin_nome,
  a.avatar_url AS admin_avatar,
  COUNT(o.id) FILTER (
    WHERE o.status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA')
  )::INTEGER AS qtd_abertas,
  COUNT(o.id) FILTER (
    WHERE o.status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA')
      AND GREATEST((CURRENT_DATE - o.ordem_detectada_em::date), 0) >= 7
  )::INTEGER AS qtd_atrasadas
FROM public.pmpl_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.ordens_notas_acompanhamento o
       ON TRIM(UPPER(o.fornecedor_codigo)) = c.fornecedor_codigo
      AND o.tipo_ordem = 'PMPL'
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url
ORDER BY qtd_abertas DESC NULLS LAST;

COMMENT ON VIEW public.vw_pmpl_carteira_resumo IS
  'Carteira PMPL por fornecedor com contagens de ordens abertas e atrasadas. Uso exclusivo da UI de gestão.';
