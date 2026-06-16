-- 00293_saida_operacional_fixes.sql
-- Patch para 00292: adiciona validações críticas nas RPCs de saída operacional.
-- Fix 3: criar_saida_operacional valida array não-vazio
-- Fix 4: cancelar_saida_operacional verifica NOT FOUND
-- Fix 5: registrar_resultado_ordem verifica NOT FOUND
-- Fix 6: registrar_resultado_ordem valida que saída está em_rota antes do UPDATE
-- Fix 7: p_observacao DEFAULT NULL em criar_saida_operacional

-- RPC: criar saída operacional (admin)
CREATE OR REPLACE FUNCTION public.criar_saida_operacional(
  p_operacional_codigo text,
  p_data_saida         timestamptz,
  p_admin_id           uuid,
  p_ordens             jsonb,  -- array de {ordem_codigo, numero_nota, unidade, texto_breve, status_ordem_raw_snapshot, tipo_ordem}
  p_observacao         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saida_id uuid;
  v_nome     text;
BEGIN
  SELECT nome INTO v_nome FROM public.dim_operacionais WHERE codigo = p_operacional_codigo;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Operacional não encontrado: %', p_operacional_codigo;
  END IF;

  IF jsonb_array_length(p_ordens) = 0 THEN
    RAISE EXCEPTION 'A saída deve conter ao menos uma ordem';
  END IF;

  INSERT INTO public.operacional_saidas (
    operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
    data_saida, observacao
  ) VALUES (
    p_operacional_codigo, v_nome, p_admin_id, p_data_saida, p_observacao
  ) RETURNING id INTO v_saida_id;

  INSERT INTO public.operacional_saida_ordens (
    saida_id, ordem_codigo, numero_nota, unidade, texto_breve,
    status_ordem_raw_snapshot, tipo_ordem
  )
  SELECT
    v_saida_id,
    (o->>'ordem_codigo'),
    (o->>'numero_nota'),
    (o->>'unidade'),
    (o->>'texto_breve'),
    (o->>'status_ordem_raw_snapshot'),
    (o->>'tipo_ordem')
  FROM jsonb_array_elements(p_ordens) AS o;

  RETURN v_saida_id;
END;
$$;

-- RPC: cancelar saída (admin)
CREATE OR REPLACE FUNCTION public.cancelar_saida_operacional(
  p_saida_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.operacional_saidas
  SET status = 'cancelada'
  WHERE id = p_saida_id AND status = 'em_rota';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saída não encontrada ou não está em rota: %', p_saida_id;
  END IF;
END;
$$;

-- RPC: registrar resultado de uma ordem (técnico)
CREATE OR REPLACE FUNCTION public.registrar_resultado_ordem(
  p_saida_ordem_id   uuid,
  p_resultado        public.saida_ordem_resultado,
  p_observacao       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operacional_saidas s
    JOIN public.operacional_saida_ordens o ON o.saida_id = s.id
    WHERE o.id = p_saida_ordem_id AND s.status = 'em_rota'
  ) THEN
    RAISE EXCEPTION 'Saída não está em rota ou ordem não encontrada';
  END IF;

  UPDATE public.operacional_saida_ordens
  SET resultado          = p_resultado,
      observacao_retorno = p_observacao,
      data_resultado     = now()
  WHERE id = p_saida_ordem_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem não encontrada: %', p_saida_ordem_id;
  END IF;
END;
$$;
