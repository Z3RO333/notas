-- 00073_backfill_reassign_all_open_standalone_orders.sql
--
-- Dois problemas identificados:
--
-- PROBLEMA A — Ordens vinculadas a notas (nota_id IS NOT NULL) sem responsável
--   O sync job cria a ordem em registrar_ordens_por_notas ANTES de distribuir_notas
--   rodar. Quando a nota recebe admin, a ordem já foi criada com admin = NULL e
--   nunca é atualizada.
--   Fix: propagar administrador_id da nota para as ordens vinculadas abertas.
--   Trigger: manter sincronismo automático nos próximos syncs.
--
-- PROBLEMA B — Ordens standalone (nota_id IS NULL) mal atribuídas
--   Atribuídas antes das regras atuais (pre-00060/00067/00070).
--   Fix: zera e re-executa atribuir_responsavel_ordens_standalone() (00070+).
--
-- Regras em vigor após este backfill (standalone):
--   1. Refrigeração (keyword em texto_breve) → admin refrigeração
--      Se indisponível → Walter/Daniel (gestores)
--   2. PMPL (tipo_ordem) → responsável configurado em responsaveis_tipo_ordem
--   3. CD TURISMO / CD TARUMA (unidade_efetiva) → Adriano (cd_taruma)
--   4. CD MANAUS (unidade_efetiva)              → Brenda  (cd_manaus)
--   5. Demais → admin GERAL de menor carga (pick_fallback_admin_for_order)

-- ============================================================
-- 0) Trigger: mantém ordens vinculadas em sync com admin da nota
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_ordem_admin_from_nota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Só propaga quando administrador_id muda para um valor não-nulo
  IF NEW.administrador_id IS NOT NULL AND (OLD.administrador_id IS DISTINCT FROM NEW.administrador_id) THEN
    UPDATE public.ordens_notas_acompanhamento
    SET
      administrador_id = NEW.administrador_id,
      updated_at       = now()
    WHERE nota_id = NEW.id
      AND administrador_id IS NULL
      AND status_ordem NOT IN ('concluida', 'cancelada');
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_ordem_admin_from_nota'
  ) THEN
    CREATE TRIGGER trg_sync_ordem_admin_from_nota
      AFTER UPDATE OF administrador_id ON public.notas_manutencao
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_ordem_admin_from_nota();
  END IF;
END;
$$;

-- ============================================================
-- 1) Backfill PROBLEMA A: propaga admin da nota → ordens vinculadas
--    (nota_id IS NOT NULL, administrador_id IS NULL)
-- ============================================================
DO $$
DECLARE
  v_propagadas INTEGER;
BEGIN
  UPDATE public.ordens_notas_acompanhamento o
  SET
    administrador_id = nm.administrador_id,
    updated_at       = now()
  FROM public.notas_manutencao nm
  WHERE o.nota_id = nm.id
    AND o.administrador_id IS NULL
    AND nm.administrador_id IS NOT NULL
    AND o.status_ordem NOT IN ('concluida', 'cancelada');

  GET DIAGNOSTICS v_propagadas = ROW_COUNT;
  RAISE NOTICE 'Backfill 00073 — ordens vinculadas com admin propagado da nota: %', v_propagadas;
END;
$$;

-- ============================================================
-- 2) Diagnóstico pré-backfill standalone
-- ============================================================
DO $$
DECLARE
  v_total INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.ordens_notas_acompanhamento
  WHERE nota_id IS NULL
    AND status_ordem NOT IN ('concluida', 'cancelada');

  RAISE NOTICE 'Backfill 00073 — % ordens standalone abertas serão reatribuídas', v_total;
END;
$$;

-- ============================================================
-- 3) Zera atribuições de todas as ordens standalone abertas
-- ============================================================
UPDATE public.ordens_notas_acompanhamento
SET
  administrador_id = NULL,
  updated_at       = now()
WHERE nota_id IS NULL
  AND status_ordem NOT IN ('concluida', 'cancelada');

-- ============================================================
-- 4) Reatribui com as regras atuais (00070+)
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.atribuir_responsavel_ordens_standalone();

  RAISE NOTICE
    'Backfill 00073 — atribuição standalone: total=% preenchidos=% refrig=% pmpl=% cd_fixo=% fallback=% sem_destino=%',
    r.total_candidatas,
    r.responsaveis_preenchidos,
    r.atribuicoes_refrigeracao,
    r.atribuicoes_pmpl_config,
    r.atribuicoes_cd_fixo,
    r.atribuicoes_fallback,
    r.sem_destino;
END;
$$;

-- ============================================================
-- 5) Realinha ordens PMPL para o responsável configurado
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.realinhar_responsavel_pmpl_standalone();

  RAISE NOTICE
    'Backfill 00073 — PMPL realign: candidatas=% reatribuicoes=%',
    r.total_candidatas,
    r.reatribuicoes;
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'Backfill 00073 — realinhar_responsavel_pmpl_standalone não existe, pulando.';
END;
$$;
