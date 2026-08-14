-- 00329_backfill_ordens_incendio_gestao_incendio.sql
--
-- A migration 00327 corrigiu resolve_admin_ordem_sem_nota() para reconhecer
-- 'criticos', mas a correção não é retroativa: ordens standalone (sem nota,
-- nota_id IS NULL) de incêndio/extintor/hidrante/bomba de incêndio que já
-- estavam abertas antes da correção continuaram com o dono antigo (Fabiola,
-- Rosana, Brenda, Paula, Wanderlucio, Daniel Duran, Suelém).
--
-- Backfill explícito, escopado só a ordens ABERTAS (status não-final) —
-- ordens já concluídas/canceladas ficam como estão, preservando histórico.

-- 1. Ordens standalone (sem nota vinculada) — dono vem de ordens_notas_acompanhamento
UPDATE public.ordens_notas_acompanhamento o
SET administrador_id = '49886ba1-fbe3-4fa6-ac9b-a498d97e6635'
FROM public.ordens_manutencao_referencia r
WHERE r.ordem_codigo_norm = o.ordem_codigo
  AND o.nota_id IS NULL
  AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  AND o.administrador_id IS DISTINCT FROM '49886ba1-fbe3-4fa6-ac9b-a498d97e6635'
  AND (
    UPPER(r.texto_breve) LIKE '%INCEND%' OR UPPER(r.texto_breve) LIKE '%INCÊND%'
    OR UPPER(r.texto_breve) LIKE '%EXTINTOR%' OR UPPER(r.texto_breve) LIKE '%HIDRANTE%'
  );

-- 2. Ordens com nota vinculada — dono foi herdado da nota (registrar_ordens_por_notas
--    usa COALESCE, não recalcula), então precisa corrigir nota E ordem.
UPDATE public.notas_manutencao n
SET administrador_id = '49886ba1-fbe3-4fa6-ac9b-a498d97e6635', updated_at = now()
FROM public.ordens_notas_acompanhamento o
WHERE o.nota_id = n.id
  AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  AND n.administrador_id IS DISTINCT FROM '49886ba1-fbe3-4fa6-ac9b-a498d97e6635'
  AND (
    UPPER(n.descricao) LIKE '%INCEND%' OR UPPER(n.descricao) LIKE '%INCÊND%'
    OR UPPER(n.descricao) LIKE '%EXTINTOR%' OR UPPER(n.descricao) LIKE '%HIDRANTE%'
  );

UPDATE public.ordens_notas_acompanhamento o
SET administrador_id = '49886ba1-fbe3-4fa6-ac9b-a498d97e6635'
FROM public.notas_manutencao n
WHERE o.nota_id = n.id
  AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  AND o.administrador_id IS DISTINCT FROM '49886ba1-fbe3-4fa6-ac9b-a498d97e6635'
  AND (
    UPPER(n.descricao) LIKE '%INCEND%' OR UPPER(n.descricao) LIKE '%INCÊND%'
    OR UPPER(n.descricao) LIKE '%EXTINTOR%' OR UPPER(n.descricao) LIKE '%HIDRANTE%'
  );
