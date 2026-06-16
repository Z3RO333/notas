-- 00292_saida_operacional.sql
-- Registro de saídas operacionais: admin monta saída com ordens,
-- técnico registra resultado por ordem. Auto-finaliza quando todas têm resultado.

-- Enums
DO $$ BEGIN
  CREATE TYPE public.saida_operacional_status AS ENUM ('em_rota', 'finalizada', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.saida_ordem_resultado AS ENUM ('resolvida', 'nao_resolvida', 'reagendada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela principal da saída
CREATE TABLE IF NOT EXISTS public.operacional_saidas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacional_codigo        text NOT NULL REFERENCES public.dim_operacionais(codigo),
  operacional_nome_snapshot text NOT NULL,
  criado_por_admin_id       uuid NOT NULL REFERENCES public.administradores(id),
  status                    public.saida_operacional_status NOT NULL DEFAULT 'em_rota',
  data_saida                timestamptz NOT NULL,
  data_finalizacao          timestamptz,
  observacao                text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Ordens da saída (snapshot no momento da criação)
CREATE TABLE IF NOT EXISTS public.operacional_saida_ordens (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saida_id                  uuid NOT NULL REFERENCES public.operacional_saidas(id) ON DELETE CASCADE,
  ordem_codigo              text NOT NULL,
  numero_nota               text,
  unidade                   text,
  texto_breve               text,
  status_ordem_raw_snapshot text,
  tipo_ordem                text,
  resultado                 public.saida_ordem_resultado,
  observacao_retorno        text,
  data_resultado            timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (saida_id, ordem_codigo)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_operacional_saidas_codigo
  ON public.operacional_saidas (operacional_codigo);
CREATE INDEX IF NOT EXISTS idx_operacional_saidas_status
  ON public.operacional_saidas (status);
CREATE INDEX IF NOT EXISTS idx_operacional_saida_ordens_saida_id
  ON public.operacional_saida_ordens (saida_id);

-- Trigger: auto-finaliza saída quando todas as ordens têm resultado
CREATE OR REPLACE FUNCTION public.fn_auto_finalizar_saida()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   integer;
  v_com_resultado integer;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE resultado IS NOT NULL)
  INTO v_total, v_com_resultado
  FROM public.operacional_saida_ordens
  WHERE saida_id = NEW.saida_id;

  IF v_total > 0 AND v_total = v_com_resultado THEN
    UPDATE public.operacional_saidas
    SET status = 'finalizada',
        data_finalizacao = now()
    WHERE id = NEW.saida_id
      AND status = 'em_rota';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_finalizar_saida ON public.operacional_saida_ordens;
CREATE TRIGGER trg_auto_finalizar_saida
  AFTER UPDATE OF resultado ON public.operacional_saida_ordens
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_finalizar_saida();

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
