-- 00278_operacional_role_and_consultas.sql
-- Adiciona suporte ao papel 'operacional' no cockpit (técnicos de campo, somente leitura).
--
-- 1. Novo valor 'operacional' no enum user_role
-- 2. Coluna operacional_codigo em administradores (FK para dim_operacionais)
-- 3. RPC consultar_ordens_operacional — busca segura sem escrita

-- ============================================================
-- 1) Enum user_role: adiciona 'operacional'
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'operacional'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'operacional';
  END IF;
END;
$$;

-- ============================================================
-- 2) Coluna operacional_codigo em administradores
-- ============================================================
ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS operacional_codigo TEXT REFERENCES public.dim_operacionais(codigo);

COMMENT ON COLUMN public.administradores.operacional_codigo IS
  'Código do operacional vinculado ao usuário (FK dim_operacionais). '
  'Quando preenchido, a tela /operacional/consultas exibe a seção "Minhas Ordens" filtrada por este código.';

-- ============================================================
-- 3) RPC de consulta de ordens para operacionais (somente leitura)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consultar_ordens_operacional(
  p_q                   TEXT        DEFAULT NULL,
  p_fornecedor_codigo   TEXT        DEFAULT NULL,
  p_unidade             TEXT        DEFAULT NULL,
  p_status              TEXT        DEFAULT NULL,
  p_limit               INT         DEFAULT 20,
  p_cursor_detectada    TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id           UUID        DEFAULT NULL
)
RETURNS TABLE (
  ordem_id            UUID,
  ordem_codigo        TEXT,
  numero_nota         TEXT,
  unidade             TEXT,
  status_ordem_raw    TEXT,
  dias_em_aberto      INT,
  semaforo_atraso     TEXT,
  fornecedor_codigo   TEXT,
  fornecedor_nome     TEXT,
  descricao           TEXT,
  responsavel_nome    TEXT,
  responsavel_email   TEXT,
  ordem_detectada_em  TIMESTAMPTZ,
  tipo_ordem          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eff AS (
    SELECT
      o.id,
      o.ordem_codigo,
      o.numero_nota,
      COALESCE(o.unidade, d.unidade)                 AS unidade,
      o.status_ordem_raw,
      o.fornecedor_codigo,
      o.fornecedor_nome,
      COALESCE(o.texto_breve, n.descricao)           AS descricao,
      o.tipo_ordem,
      COALESCE(o.data_entrada, o.ordem_detectada_em) AS det_em,
      CASE
        WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
        ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
      END                                            AS resp_id
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.notas_manutencao n    ON n.id = o.nota_id
    LEFT JOIN public.dim_centro_unidade d  ON d.centro = o.centro
    WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) IS NOT NULL
      AND (n.id IS NULL OR n.exclui_cockpit = false)
  )
  SELECT
    e.id                                                                      AS ordem_id,
    e.ordem_codigo,
    e.numero_nota,
    e.unidade,
    e.status_ordem_raw,
    CASE
      WHEN public.status_raw_eh_final(e.status_ordem_raw) THEN 0
      ELSE GREATEST((CURRENT_DATE - e.det_em::date), 0)
    END::int                                                                  AS dias_em_aberto,
    CASE
      WHEN public.status_raw_eh_final(e.status_ordem_raw)               THEN 'neutro'
      WHEN GREATEST((CURRENT_DATE - e.det_em::date), 0) >= 7            THEN 'vermelho'
      WHEN GREATEST((CURRENT_DATE - e.det_em::date), 0) >= 3            THEN 'amarelo'
      ELSE 'verde'
    END                                                                       AS semaforo_atraso,
    e.fornecedor_codigo,
    e.fornecedor_nome,
    e.descricao,
    a.nome                                                                    AS responsavel_nome,
    a.email                                                                   AS responsavel_email,
    e.det_em                                                                  AS ordem_detectada_em,
    e.tipo_ordem
  FROM eff e
  LEFT JOIN public.administradores a ON a.id = e.resp_id
  WHERE
    (
      p_fornecedor_codigo IS NULL
      OR BTRIM(p_fornecedor_codigo) = ''
      OR public.normalize_supplier_code(e.fornecedor_codigo)
           = public.normalize_supplier_code(BTRIM(p_fornecedor_codigo))
    )
    AND (
      p_unidade IS NULL
      OR BTRIM(p_unidade) = ''
      OR COALESCE(e.unidade, '') ILIKE ('%' || BTRIM(p_unidade) || '%')
    )
    AND (
      p_status IS NULL
      OR BTRIM(p_status) = ''
      OR e.status_ordem_raw = BTRIM(p_status)
    )
    AND (
      p_q IS NULL
      OR BTRIM(p_q) = ''
      OR e.ordem_codigo ILIKE ('%' || BTRIM(p_q) || '%')
      OR e.numero_nota  ILIKE ('%' || BTRIM(p_q) || '%')
      OR COALESCE(e.unidade, '')         ILIKE ('%' || BTRIM(p_q) || '%')
      OR COALESCE(e.fornecedor_nome, '') ILIKE ('%' || BTRIM(p_q) || '%')
      OR COALESCE(e.descricao, '')       ILIKE ('%' || BTRIM(p_q) || '%')
    )
    AND (
      p_cursor_detectada IS NULL
      OR e.det_em < p_cursor_detectada
      OR (e.det_em = p_cursor_detectada AND e.id::text < p_cursor_id::text)
    )
  ORDER BY e.det_em DESC, e.id DESC
  LIMIT LEAST(COALESCE(p_limit, 20), 100)
$$;
