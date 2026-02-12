-- 00014_admin_panel_setup.sql
-- Painel administrativo restrito: novos campos, Walter, audit log, distribuicao atualizada

-- ============================================================
-- 1. NOVOS CAMPOS NA TABELA DE ADMINISTRADORES
-- ============================================================
ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS recebe_distribuicao BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS em_ferias BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.administradores
  ADD COLUMN IF NOT EXISTS motivo_bloqueio TEXT;

-- ============================================================
-- 2. INSERIR WALTER RODRIGUEZ COMO GESTOR
-- ============================================================
INSERT INTO public.administradores (nome, email, role, ativo, max_notas, especialidade)
VALUES ('Walter Rodriguez', 'walterrodrigues@bemol.com.br', 'gestor', true, 50, 'geral')
ON CONFLICT (email) DO UPDATE SET role = 'gestor';

-- ============================================================
-- 3. TABELA DE AUDITORIA DE ACOES ADMIN
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id UUID NOT NULL REFERENCES public.administradores(id),
  acao TEXT NOT NULL,
  alvo_id UUID REFERENCES public.administradores(id),
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Desabilitar RLS (consistente com o restante do sistema)
ALTER TABLE public.admin_audit_log DISABLE ROW LEVEL SECURITY;

-- Index para consultas por data
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON public.admin_audit_log (created_at DESC);

-- ============================================================
-- 4. ATUALIZAR VIEW DE CARGA — INCLUIR NOVOS CAMPOS
-- ============================================================
CREATE OR REPLACE VIEW public.vw_carga_administradores AS
SELECT
  a.id,
  a.nome,
  a.email,
  a.ativo,
  a.max_notas,
  a.avatar_url,
  a.especialidade,
  COUNT(n.id) FILTER (WHERE n.status = 'nova') AS qtd_nova,
  COUNT(n.id) FILTER (WHERE n.status = 'em_andamento') AS qtd_em_andamento,
  COUNT(n.id) FILTER (WHERE n.status = 'encaminhada_fornecedor') AS qtd_encaminhada,
  COUNT(n.id) FILTER (WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')) AS qtd_abertas,
  COUNT(n.id) FILTER (WHERE n.status = 'concluida') AS qtd_concluidas,
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada') AS qtd_canceladas,
  a.recebe_distribuicao,
  a.em_ferias
FROM public.administradores a
LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
GROUP BY a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url, a.especialidade, a.recebe_distribuicao, a.em_ferias;

-- ============================================================
-- 5. ATUALIZAR FUNCAO DE DISTRIBUICAO — RESPEITAR NOVOS CAMPOS
-- ============================================================
CREATE OR REPLACE FUNCTION distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
  v_especialidade TEXT;
BEGIN
  -- Advisory lock: previne distribuicao concorrente
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  -- Loop pelas notas nao atribuidas (mais antiga primeiro)
  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Determina a especialidade baseado na descricao da nota
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    -- Se nao encontrou nenhuma regra, vai para 'geral'
    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Busca admin com menor carga DENTRO da especialidade
    -- FILTROS: ativo, recebe_distribuicao, nao em ferias
    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.max_notas, a.nome
    HAVING COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < a.max_notas
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    -- Se nenhum admin da especialidade disponivel, tenta 'geral' como fallback
    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n
        ON n.administrador_id = a.id
      WHERE a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.max_notas, a.nome
      HAVING COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      ) < a.max_notas
      ORDER BY open_count ASC, a.nome ASC
      LIMIT 1;
    END IF;

    -- Se nenhum admin disponivel, para
    IF v_admin IS NULL THEN
      EXIT;
    END IF;

    -- Atribui a nota
    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    -- Log da atribuicao
    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    -- Auditoria
    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuicao automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    -- Retorna a atribuicao
    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
