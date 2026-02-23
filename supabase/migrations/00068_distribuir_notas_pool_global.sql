-- 00068_distribuir_notas_pool_global.sql
--
-- Regra de negócio:
--   Nota é operação de cockpit de notas.
--   A distribuição NÃO deve depender de especialidade/palavra-chave.
--   Toda nota elegível entra no pool global de admins operacionais.
--
-- Impacto:
--   - remove roteamento por regras_distribuicao na distribuir_notas
--   - mantém proteção para não distribuir notas já vinculadas a ordem
--   - mantém round-robin por menor carga (qtd de notas abertas)

CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  FOR v_nota IN
    SELECT nm.id
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ordens_notas_acompanhamento o
        WHERE o.nota_id = nm.id
           OR (
             o.nota_id IS NULL
             AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
             AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
                 = COALESCE(NULLIF(LTRIM(BTRIM(nm.numero_nota), '0'), ''), '0')
           )
      )
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
    GROUP BY a.id, a.nome
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL THEN
      EXIT;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (pool_global) - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.distribuir_notas(UUID) IS
  'Distribui notas novas sem responsável no pool global de admins operacionais (sem roteamento por especialidade).';
