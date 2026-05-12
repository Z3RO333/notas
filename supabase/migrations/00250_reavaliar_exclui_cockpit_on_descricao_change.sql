-- 00250_reavaliar_exclui_cockpit_on_descricao_change.sql
--
-- Problema: distribuir_notas() filtra por exclui_cockpit=false. Quando uma nota
-- chega com descricao casando regra de especialidade='excluir' (ex: MECÂNICA da
-- migration 00238 ou PREVENTIVA DE 1.500 HORAS da 00221), a flag é setada e
-- nunca mais é re-avaliada. Se o solicitante corrige a descricao no SAP depois,
-- o sync atualiza o campo mas a nota fica travada fora do cockpit.
--
-- Solução: trigger BEFORE UPDATE OF descricao que, quando a nova descricao não
-- casa mais com nenhuma regra 'excluir', libera a nota (exclui_cockpit=false)
-- desde que ela ainda não tenha sido distribuída.
--
-- Caso reverso (clean -> casa com excluir) NÃO é tratado aqui — fica como
-- migrations 00221/00238 já fazem via backfill pontual.

-- ============================================================
-- 1. Função do trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_reavaliar_exclui_cockpit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.descricao IS NOT DISTINCT FROM OLD.descricao THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.exclui_cockpit, false) = false THEN
    RETURN NEW;
  END IF;

  IF NEW.administrador_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.regras_distribuicao r
    WHERE r.especialidade = 'excluir'
      AND UPPER(NEW.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.exclui_cockpit := false;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. Trigger BEFORE UPDATE OF descricao
-- ============================================================
DROP TRIGGER IF EXISTS trg_reavaliar_exclui_cockpit ON public.notas_manutencao;

CREATE TRIGGER trg_reavaliar_exclui_cockpit
BEFORE UPDATE OF descricao ON public.notas_manutencao
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_reavaliar_exclui_cockpit();

-- ============================================================
-- 3. Backfill: liberar notas atualmente travadas
-- ============================================================
UPDATE public.notas_manutencao n
SET exclui_cockpit = false,
    updated_at     = now()
WHERE COALESCE(n.exclui_cockpit, false) = true
  AND n.administrador_id IS NULL
  AND n.status = 'nova'
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1
    FROM public.regras_distribuicao r
    WHERE r.especialidade = 'excluir'
      AND UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  );
