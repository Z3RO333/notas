-- 00007_especialidades.sql
-- Regras de distribuição por especialidade

-- Adiciona avatar_url e grupo de especialidade aos administradores
ALTER TABLE public.administradores ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.administradores ADD COLUMN IF NOT EXISTS especialidade TEXT DEFAULT 'geral';

-- Tabela de palavras-chave para matching
CREATE TABLE public.regras_distribuicao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  palavra_chave TEXT NOT NULL,
  especialidade TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_regras_especialidade ON public.regras_distribuicao(especialidade);

-- ============================================================
-- INSERIR PALAVRAS-CHAVE POR ESPECIALIDADE
-- ============================================================

-- Refrigeracao → suelemsilva@bemol.com.br
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade) VALUES
  ('AR CONDICIONADO', 'refrigeracao'),
  ('AR-CONDICIONADO', 'refrigeracao'),
  ('AR-COND', 'refrigeracao'),
  ('CENTRAIS DE AR', 'refrigeracao'),
  ('CENTRAL DE AR', 'refrigeracao'),
  ('VRF', 'refrigeracao'),
  ('CHILLER', 'refrigeracao'),
  ('SPLITAO', 'refrigeracao'),
  ('SPLIT', 'refrigeracao'),
  ('FREEZER', 'refrigeracao'),
  ('GELADEIRA', 'refrigeracao'),
  ('TERMOMETRO DE GELADEIRA', 'refrigeracao'),
  ('REFRIGERACAO', 'refrigeracao'),
  ('BTUS', 'refrigeracao');

-- Elevadores/Geradores/Subestacao → gustavoandrade + paulamatos
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade) VALUES
  ('ELEVADOR', 'elevadores'),
  ('ESCADA ROLANTE', 'elevadores'),
  ('SUBESTACAO', 'elevadores'),
  ('GERADOR', 'elevadores'),
  ('GRUPO GERADOR', 'elevadores'),
  ('MONTA CARGA', 'elevadores'),
  ('MONTA-CARGA', 'elevadores'),
  ('PLATAFORMA', 'elevadores');

-- ============================================================
-- ATUALIZAR ESPECIALIDADE DOS ADMINISTRADORES
-- ============================================================
UPDATE public.administradores SET especialidade = 'refrigeracao' WHERE email = 'suelemsilva@bemol.com.br';
UPDATE public.administradores SET especialidade = 'elevadores' WHERE email = 'gustavoandrade@bemol.com.br';
UPDATE public.administradores SET especialidade = 'elevadores' WHERE email = 'paulamatos@bemol.com.br';
UPDATE public.administradores SET especialidade = 'geral' WHERE email = 'wanderluciomendes@bemol.com.br';
UPDATE public.administradores SET especialidade = 'geral' WHERE email = 'rosanafigueira@bemol.com.br';
UPDATE public.administradores SET especialidade = 'geral' WHERE email = 'maykycastro@bemol.com.br';
UPDATE public.administradores SET especialidade = 'geral' WHERE email = 'fabiolatentunge@bemol.com.br';

-- ============================================================
-- RECRIAR FUNCAO DE DISTRIBUICAO COM REGRAS DE ESPECIALIDADE
-- ============================================================
CREATE OR REPLACE FUNCTION distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
  v_especialidade TEXT;
BEGIN
  -- Advisory lock: previne distribuição concorrente
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  -- Loop pelas notas não atribuídas (mais antiga primeiro)
  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Determina a especialidade baseado na descrição da nota
    -- Busca a primeira palavra-chave que aparece na descrição (case insensitive)
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    -- Se não encontrou nenhuma regra, vai para 'geral'
    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Busca admin com menor carga DENTRO da especialidade
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
      AND a.role = 'admin'
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
        AND a.role = 'admin'
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

    -- Log da atribuição
    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    -- Auditoria
    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    -- Retorna a atribuição
    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RECRIAR VIEW COM ESPECIALIDADE
-- ============================================================
DROP VIEW IF EXISTS public.vw_carga_administradores;
CREATE VIEW public.vw_carga_administradores AS
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
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada') AS qtd_canceladas
FROM public.administradores a
LEFT JOIN public.notas_manutencao n ON n.administrador_id = a.id
WHERE a.role = 'admin'
GROUP BY a.id, a.nome, a.email, a.ativo, a.max_notas, a.avatar_url, a.especialidade;

-- RLS para regras_distribuicao (gestor pode ver e editar)
ALTER TABLE public.regras_distribuicao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos autenticados veem regras"
  ON public.regras_distribuicao FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Gestor edita regras"
  ON public.regras_distribuicao FOR ALL
  TO authenticated
  USING (get_my_role() = 'gestor');
