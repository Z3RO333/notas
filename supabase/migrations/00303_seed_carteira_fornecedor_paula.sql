-- 00303_seed_carteira_fornecedor_paula.sql
--
-- Adiciona fornecedores à carteira de Pedidos de Compra de Paula Matos
-- (role=admin, especialidade=geral), a pedido do gestor:
--   - Preventivas anuais: LEVIANE ARAUJO DE LIMA - ME (8203, farmas + CD's,
--     mesmo código para os dois segmentos), JONAS LEITÃO DA CUNHA / HiClean
--     Wesley (11558), UZZIENERGY (18052)
--   - Corretivas: EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS (857)
--
-- Códigos e nomes confirmados contra dim_fornecedores / ordens_notas_acompanhamento
-- antes de aplicar. fornecedor_codigo é UNIQUE na tabela (uq_pedidos_carteira_fornecedor_codigo)
-- e nenhum dos 4 códigos tinha carteira ativa antes desta migration.

INSERT INTO public.pedidos_compra_carteira_fornecedor (
  fornecedor_codigo, fornecedor_nome, administrador_id, tipo_carteira, ativo
)
SELECT v.fornecedor_codigo, v.fornecedor_nome, a.id, v.tipo_carteira, true
FROM (VALUES
  ('8203',  'LEVIANE ARAUJO DE LIMA - ME',                 'preventiva_anual'),
  ('11558', 'JONAS LEITÃO DA CUNHA',                       'preventiva_anual'),
  ('18052', 'UZZIENERGY',                                  'preventiva_anual'),
  ('857',   'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS', 'corretiva')
) AS v(fornecedor_codigo, fornecedor_nome, tipo_carteira)
JOIN public.administradores a ON a.email = 'paulamatos@bemol.com.br'
ON CONFLICT (fornecedor_codigo) DO UPDATE SET
  fornecedor_nome  = EXCLUDED.fornecedor_nome,
  administrador_id = EXCLUDED.administrador_id,
  tipo_carteira    = EXCLUDED.tipo_carteira,
  ativo            = true,
  updated_at       = now();
