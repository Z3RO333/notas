-- 00325_backfill_notas_incendio_ocultas.sql
--
-- Notas antigas de incêndio/extintor/mangueira ficaram ocultas
-- (exclui_cockpit=true) desde a saída do especialista 'criticos' (Mazurkevs).
-- Agora que existe a Gestão de Incêndio (00323), reativa e redistribui.

WITH candidatas AS (
  SELECT n.id
  FROM public.notas_manutencao n
  WHERE n.exclui_cockpit = true
    AND n.status = 'nova'
    AND EXISTS (
      SELECT 1 FROM public.regras_distribuicao r
      WHERE r.especialidade = 'criticos'
        AND UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    )
)
INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
SELECT id, 'exclui_cockpit', 'true', 'false',
  'Backfill Gestão de Incêndio: reativação de nota oculta por falta de especialista criticos'
FROM candidatas;

WITH candidatas AS (
  SELECT n.id
  FROM public.notas_manutencao n
  WHERE n.exclui_cockpit = true
    AND n.status = 'nova'
    AND EXISTS (
      SELECT 1 FROM public.regras_distribuicao r
      WHERE r.especialidade = 'criticos'
        AND UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    )
)
UPDATE public.notas_manutencao
SET exclui_cockpit = false,
    administrador_id = NULL,
    distribuida_em = NULL,
    updated_at = now()
WHERE id IN (SELECT id FROM candidatas);

-- Redistribui tudo que ficou com administrador_id NULL (inclui as notas acima).
SELECT * FROM public.distribuir_notas();
