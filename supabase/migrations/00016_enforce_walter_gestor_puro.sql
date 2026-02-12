-- =============================================
-- MIGRATION 00016: Enforce Walter como gestor puro
-- Corrige cadastro e devolve notas abertas para fila sem atribuicao
-- =============================================

DO $$
DECLARE
  v_walter_id UUID;
BEGIN
  UPDATE public.administradores
  SET
    nome = 'Walter Rodrigues',
    role = 'gestor',
    recebe_distribuicao = false,
    ativo = true,
    updated_at = now()
  WHERE email = 'walterrodrigues@bemol.com.br'
  RETURNING id INTO v_walter_id;

  IF v_walter_id IS NULL THEN
    RAISE EXCEPTION 'Administrador com email % nao encontrado', 'walterrodrigues@bemol.com.br';
  END IF;

  WITH moved AS (
    UPDATE public.notas_manutencao
    SET
      administrador_id = NULL,
      distribuida_em = NULL,
      updated_at = now()
    WHERE administrador_id = v_walter_id
      AND status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    RETURNING id
  )
  INSERT INTO public.notas_historico (
    nota_id,
    campo_alterado,
    valor_anterior,
    valor_novo,
    motivo
  )
  SELECT
    moved.id,
    'administrador_id',
    v_walter_id::TEXT,
    'NULL',
    'Migracao 00016: Walter Rodrigues configurado como gestor puro; nota devolvida para fila sem atribuicao'
  FROM moved;
END;
$$ LANGUAGE plpgsql;
