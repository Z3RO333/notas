-- 00220_transferir_pmpl_gustavo_para_mazurkevs.sql
--
-- Transfere todas as ordens PMPL ativas de Gustavo para Mazurkevs.
-- PMOS: apenas as do escopo criticos (alarme de incêndio, extintor, mangueira)
-- — nenhuma no momento, mas a lógica fica registrada para futuros sync.
--
-- Gustavo mantém seu papel de gestor/PMPL para distribuição futura;
-- Mazurkevs assume o acompanhamento das ordens já existentes.

DO $$
DECLARE
  v_gustavo_id    UUID;
  v_mazurkevs_id  UUID;
  v_pmpl_count    INTEGER;
  v_pmos_count    INTEGER;
BEGIN
  SELECT id INTO v_gustavo_id
  FROM public.administradores
  WHERE email = 'gustavoandrade@bemol.com.br';

  SELECT id INTO v_mazurkevs_id
  FROM public.administradores
  WHERE email = 'mazurkevssantos@bemol.com.br';

  IF v_gustavo_id IS NULL THEN
    RAISE EXCEPTION 'Gustavo não encontrado';
  END IF;

  IF v_mazurkevs_id IS NULL THEN
    RAISE EXCEPTION 'Mazurkevs não encontrado';
  END IF;

  -- Transfere todas as PMPL ativas de Gustavo
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_mazurkevs_id,
      updated_at       = now()
  WHERE administrador_id = v_gustavo_id
    AND tipo_ordem = 'PMPL'
    AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  GET DIAGNOSTICS v_pmpl_count = ROW_COUNT;

  -- Transfere PMOS do escopo criticos (alarme, extintor, mangueira)
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_mazurkevs_id,
      updated_at       = now()
  FROM public.notas_manutencao n
  WHERE ordens_notas_acompanhamento.nota_id = n.id
    AND ordens_notas_acompanhamento.administrador_id = v_gustavo_id
    AND ordens_notas_acompanhamento.tipo_ordem = 'PMOS'
    AND ordens_notas_acompanhamento.status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
    AND (
      UPPER(n.descricao) LIKE '%ALARME DE INCENDIO%'
      OR UPPER(n.descricao) LIKE '%EXTINTOR%'
      OR UPPER(n.descricao) LIKE '%MANGUEIRA%'
    );

  GET DIAGNOSTICS v_pmos_count = ROW_COUNT;

  RAISE NOTICE 'Transferido: % PMPL + % PMOS (criticos) de Gustavo → Mazurkevs',
    v_pmpl_count, v_pmos_count;
END;
$$;
