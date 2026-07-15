-- 00308_pedidos_compra_admin_nullable_sem_responsavel.sql
--
-- pedidos_compra.administrador_id tinha NOT NULL, sem suporte a "sem responsável"
-- (diferente de ordens_notas_acompanhamento, que já permite administrador_id NULL
-- para representar ordens órfãs/sem dono claro).
-- Remove a constraint para permitir o mesmo padrão em Pedidos de Compra.
-- Nenhum trigger ou índice depende de NOT NULL nessa coluna.

ALTER TABLE public.pedidos_compra ALTER COLUMN administrador_id DROP NOT NULL;

-- Marca os 3 pedidos do fornecedor 101 (CLAUDIO ANDRADE JUNIOR) como sem responsável,
-- a pedido do usuário — ficam fora da fila individual de qualquer admin até decisão futura.
UPDATE public.pedidos_compra
SET administrador_id = NULL,
    updated_at       = now()
WHERE documento_compras IN ('4508557761','4508560364','4508590825');
