-- 00294_drop_ambiguous_criar_saida_operacional.sql
-- Remove overload antigo de criar_saida_operacional que deixa o PostgREST
-- incapaz de escolher a melhor assinatura quando a chamada usa parâmetros nomeados.

DROP FUNCTION IF EXISTS public.criar_saida_operacional(
  text,
  timestamptz,
  text,
  uuid,
  jsonb
);

CREATE OR REPLACE FUNCTION public.criar_saida_operacional(
  p_operacional_codigo text,
  p_data_saida         timestamptz,
  p_admin_id           uuid,
  p_ordens             jsonb,
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
  SELECT nome INTO v_nome
  FROM public.dim_operacionais
  WHERE codigo = p_operacional_codigo
    AND ativo = true;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Operacional não encontrado: %', p_operacional_codigo;
  END IF;

  IF jsonb_array_length(p_ordens) = 0 THEN
    RAISE EXCEPTION 'A saída deve conter ao menos uma ordem';
  END IF;

  INSERT INTO public.operacional_saidas (
    operacional_codigo,
    operacional_nome_snapshot,
    criado_por_admin_id,
    data_saida,
    observacao
  ) VALUES (
    p_operacional_codigo,
    v_nome,
    p_admin_id,
    p_data_saida,
    p_observacao
  ) RETURNING id INTO v_saida_id;

  INSERT INTO public.operacional_saida_ordens (
    saida_id,
    ordem_codigo,
    numero_nota,
    unidade,
    texto_breve,
    status_ordem_raw_snapshot,
    tipo_ordem
  )
  SELECT
    v_saida_id,
    o->>'ordem_codigo',
    o->>'numero_nota',
    o->>'unidade',
    o->>'texto_breve',
    o->>'status_ordem_raw_snapshot',
    o->>'tipo_ordem'
  FROM jsonb_array_elements(p_ordens) AS o;

  RETURN v_saida_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
