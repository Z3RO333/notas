-- 00227_fix_concluido_em_trigger_e_backfill.sql
--
-- Problema identificado em 00226:
-- O backfill usou status_atualizado_em, que o sync do Databricks atualiza em
-- TODO processamento (não só na mudança de status). Ordens concluídas em
-- janeiro que foram processadas em abril receberam concluido_em = abril.
-- Resultado: 5.235 ordens com concluido_em incorreto em abril.
--
-- O trigger também estava errado: disparava mesmo quando o status não mudava
-- (ex: sync enviando CONCLUIDO numa ordem já CONCLUIDO), setando concluido_em
-- para "agora" em ordens historicamente concluídas.
--
-- Solução:
-- 1. Limpar TODOS os valores de concluido_em (dados unreliáveis)
-- 2. Corrigir o trigger para só setar concluido_em na TRANSIÇÃO
--    de não-final → final (verificando OLD.status_ordem_raw)
-- 3. A partir de agora, apenas transições reais setam concluido_em

-- ── 1. Limpar backfill incorreto ─────────────────────────────────────────────

UPDATE public.ordens_notas_acompanhamento
SET concluido_em = NULL
WHERE concluido_em IS NOT NULL;

-- ── 2. Trigger corrigido: só dispara em transição de status ──────────────────

CREATE OR REPLACE FUNCTION public.set_concluido_em()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status_finais CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CANCELADA','CONCLUIDO','CONCLUIDA',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
BEGIN
  -- Só seta se:
  -- 1. concluido_em ainda não foi setado
  -- 2. O novo status é final
  -- 3. É um INSERT com status final, OU é um UPDATE onde o status ANTERIOR não era final
  --    (ou seja: transição real de não-final → final)
  IF NEW.concluido_em IS NULL
     AND UPPER(BTRIM(COALESCE(NEW.status_ordem_raw, ''))) = ANY(v_status_finais)
     AND (
       TG_OP = 'INSERT'
       OR NOT (UPPER(BTRIM(COALESCE(OLD.status_ordem_raw, ''))) = ANY(v_status_finais))
     )
  THEN
    NEW.concluido_em := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_concluido_em() IS
  'Seta concluido_em apenas na primeira transição de status não-final para final. Nunca sobrescreve.';
