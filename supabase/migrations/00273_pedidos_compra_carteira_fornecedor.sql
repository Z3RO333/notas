-- 00273_pedidos_compra_carteira_fornecedor.sql
--
-- Carteira de Fornecedores em Pedidos de Compra.
-- Vínculo fixo fornecedor → administrador geral, para um conjunto restrito de
-- fornecedores (regra de negócio aplicável apenas a admins role='admin' e
-- especialidade='geral': Paula, Mayky, Rosana, Fabíola, Wanderlucio).
--
-- Cria:
--   1. pedidos_compra_carteira_fornecedor       — vínculo ativo fornecedor → admin
--   2. validar_carteira_fornecedor_admin_geral  — trigger: só admin geral pode ser dono
--   3. pedidos_compra_carteira_fornecedor_audit — histórico imutável de realocações
--   4. vw_pedidos_carteira_fornecedor_resumo    — view de leitura para a UI

-- ============================================================
-- 1) Tabela principal
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pedidos_compra_carteira_fornecedor (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_codigo TEXT        NOT NULL,
  fornecedor_nome   TEXT        NOT NULL,
  administrador_id  UUID        NOT NULL REFERENCES public.administradores(id),
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        REFERENCES public.administradores(id),
  updated_by        UUID        REFERENCES public.administradores(id),

  CONSTRAINT uq_pedidos_carteira_fornecedor_codigo UNIQUE (fornecedor_codigo)
);

COMMENT ON TABLE public.pedidos_compra_carteira_fornecedor IS
  'Vínculo fixo fornecedor → administrador geral responsável, exclusivo da aba Pedidos de Compra. Não reatribui pedidos históricos — apenas organiza a carteira a partir de agora.';

COMMENT ON COLUMN public.pedidos_compra_carteira_fornecedor.fornecedor_codigo IS
  'Código SAP do fornecedor, normalizado via normalize_supplier_code(). Chave de lookup.';

CREATE INDEX IF NOT EXISTS idx_pedidos_carteira_fornecedor_codigo
  ON public.pedidos_compra_carteira_fornecedor (fornecedor_codigo);

CREATE INDEX IF NOT EXISTS idx_pedidos_carteira_fornecedor_admin
  ON public.pedidos_compra_carteira_fornecedor (administrador_id);

-- ============================================================
-- 2) Trigger de validação — só admin geral pode ser dono
-- ============================================================
CREATE OR REPLACE FUNCTION public.validar_carteira_fornecedor_admin_geral()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role user_role;
  v_especialidade TEXT;
BEGIN
  SELECT role, especialidade
  INTO v_role, v_especialidade
  FROM public.administradores
  WHERE id = NEW.administrador_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Administrador não encontrado: %', NEW.administrador_id;
  END IF;

  IF v_role <> 'admin' OR v_especialidade IS DISTINCT FROM 'geral' THEN
    RAISE EXCEPTION
      'Carteira de fornecedores de Pedidos de Compra só pode ser atribuída a administradores gerais (role=admin, especialidade=geral). Administrador % tem role=% e especialidade=%.',
      NEW.administrador_id, v_role, v_especialidade;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validar_carteira_fornecedor_admin_geral IS
  'Garante no nível de banco que apenas administradores gerais (role=admin, especialidade=geral) podem ser donos de fornecedores na carteira de Pedidos de Compra. Gestores, especialistas, PMPL e CD ficam de fora por definição.';

DROP TRIGGER IF EXISTS trg_validar_carteira_fornecedor_admin_geral
  ON public.pedidos_compra_carteira_fornecedor;

CREATE TRIGGER trg_validar_carteira_fornecedor_admin_geral
  BEFORE INSERT OR UPDATE OF administrador_id
  ON public.pedidos_compra_carteira_fornecedor
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_carteira_fornecedor_admin_geral();

-- ============================================================
-- 3) Tabela de auditoria
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pedidos_compra_carteira_fornecedor_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_codigo TEXT        NOT NULL,
  fornecedor_nome   TEXT,
  admin_anterior_id   UUID        REFERENCES public.administradores(id),
  admin_anterior_nome TEXT,
  admin_novo_id       UUID        NOT NULL REFERENCES public.administradores(id),
  admin_novo_nome     TEXT,
  motivo            TEXT,
  alterado_por      UUID        NOT NULL REFERENCES public.administradores(id),
  alterado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pedidos_compra_carteira_fornecedor_audit IS
  'Histórico imutável de realocações da carteira de fornecedores de Pedidos de Compra. Nomes denormalizados para preservar histórico. Não registra alteração de pedidos — a realocação não toca em pedidos_compra.';

CREATE INDEX IF NOT EXISTS idx_pedidos_carteira_fornecedor_audit_fornecedor
  ON public.pedidos_compra_carteira_fornecedor_audit (fornecedor_codigo);

CREATE INDEX IF NOT EXISTS idx_pedidos_carteira_fornecedor_audit_alterado_em
  ON public.pedidos_compra_carteira_fornecedor_audit (alterado_em DESC);

-- ============================================================
-- 4) View de resumo para a UI
-- ============================================================
CREATE OR REPLACE VIEW public.vw_pedidos_carteira_fornecedor_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id         AS admin_id,
  a.nome       AS admin_nome,
  a.avatar_url AS admin_avatar,
  COUNT(p.id)::INTEGER AS qtd_pedidos,
  COUNT(p.id) FILTER (WHERE p.status = 'em_aberto')::INTEGER AS em_aberto,
  COUNT(p.id) FILTER (WHERE p.status = 'encerrado')::INTEGER AS encerrado,
  COUNT(p.id) FILTER (WHERE p.status = 'cancelado')::INTEGER AS cancelado,
  COALESCE(SUM(p.valor_liquido_total), 0)::NUMERIC AS valor_total
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.pedidos_compra p
       ON public.normalize_supplier_code(p.fornecedor) = c.fornecedor_codigo
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url
ORDER BY valor_total DESC NULLS LAST;

COMMENT ON VIEW public.vw_pedidos_carteira_fornecedor_resumo IS
  'Carteira de fornecedores de Pedidos de Compra com contagens por status e valor total. Uso exclusivo da subaba "Carteira de Fornecedores".';
