-- Estado reservado para uma saida criada durante a redistribuicao.
-- Fica separado porque valores novos de enum so podem ser usados depois do
-- commit da transacao que os adiciona.

ALTER TYPE public.saida_operacional_status
  ADD VALUE IF NOT EXISTS 'pendente_transferencia' BEFORE 'em_rota';

