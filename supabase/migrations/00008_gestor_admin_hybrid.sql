-- 00008_gestor_admin_hybrid.sql
-- Permite que gestor também receba notas (ex: gustavoandrade que eh desenvolvedor e gestor)
-- Remove filtro role='admin' da distribuição - agora qualquer usuario ativo com especialidade recebe

-- ============================================================
-- ATUALIZAR ROLE DO GUSTAVO PARA GESTOR
-- ============================================================
UPDATE public.administradores SET role = 'gestor' WHERE email = 'gustavoandrade@bemol.com.br';

-- ============================================================
-- RECRIAR FUNCAO DE DISTRIBUICAO SEM FILTRO DE ROLE
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
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    -- Se não encontrou nenhuma regra, vai para 'geral'
    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    -- Busca admin com menor carga DENTRO da especialidade
    -- REMOVIDO: filtro a.role = 'admin' (gestor também pode receber notas)
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
-- PERMITIR GESTOR VER SYNC_LOG E DISTRIBUICAO_LOG (já existe, mas garantir)
-- ============================================================
-- Já criado em 00005, nenhuma alteracao necessaria.

-- ============================================================
-- PERMITIR ADMIN VER SYNC_LOG (para gestor-admin ver saude do sistema na aba admin)
-- ============================================================
-- Não necessario: gestor já ve sync_log pela policy existente.
