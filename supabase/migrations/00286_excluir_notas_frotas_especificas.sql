-- 00286_excluir_notas_frotas_especificas.sql
--
-- Notas específicas de manutenção de frota (caminhões/veículos) identificadas
-- manualmente, sem palavra-chave comum que justifique uma regra genérica:
--   10020047 - SERV.RECAPAGEM KM 153306
--   10158075 - BORRACHARIA
--   10167050 - PREVENTIVA DA SUSPENSÃO
--   10167429 - SERVIÇO DE MANUTENÇÃO EM BAÚ
--
-- Excluídas pontualmente do cockpit/painel de notas (exclui_cockpit=true).

UPDATE public.notas_manutencao
SET exclui_cockpit  = true,
    administrador_id = NULL,
    updated_at      = now()
WHERE numero_nota IN ('10020047', '10158075', '10167050', '10167429');

DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao
  WHERE numero_nota IN ('10020047', '10158075', '10167050', '10167429')
);
