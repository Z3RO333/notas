-- 00321_prestem_preventivas_pra_paula.sql
--
-- Fornecedor 101 (CLAUDIO ANDRADE JUNIOR / PRESTEM, gerador/subestação) está
-- na carteira de Pedidos de Compra "preventiva_anual" (00281/00283) com dono
-- Mayky Castro, que foi desligado em 2026-07-14 (00307). A redistribuição do
-- desligamento (00307) só tratou a carteira PMPL e as ordens PMOS/PMPL — não
-- tocou na carteira de Pedidos de Compra, que ficou órfã apontando pro Mayky.
--
-- Realoca a carteira do fornecedor 101 pra Paula e migra os pedidos_compra
-- já existentes que ainda estão com o Mayky (RPC realocar_carteira_fornecedor_pedidos
-- só muda o dono a partir de agora, não reatribui pedidos existentes).

DO $$
DECLARE
  v_paula  UUID;
  v_mayky  UUID;
  v_walter UUID;
BEGIN
  SELECT id INTO v_paula  FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_mayky  FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_walter FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';

  IF v_paula  IS NULL THEN RAISE EXCEPTION 'Admin Paula não encontrada'; END IF;
  IF v_walter IS NULL THEN RAISE EXCEPTION 'Admin Walter (gestor) não encontrado'; END IF;

  PERFORM public.realocar_carteira_fornecedor_pedidos(
    '101',
    v_paula,
    v_walter,
    'Mayky desligado — carteira de Pedidos de Compra (preventiva anual) do fornecedor 101 (PRESTEM) realocada pra Paula'
  );

  IF v_mayky IS NOT NULL THEN
    UPDATE public.pedidos_compra
    SET administrador_id = v_paula, updated_at = now()
    WHERE public.normalize_supplier_code(fornecedor::text) = '101'
      AND administrador_id = v_mayky;
  END IF;
END $$;
