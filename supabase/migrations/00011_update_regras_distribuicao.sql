-- =============================================
-- MIGRATION 00011: Atualizar regras de distribuicao
-- com categorias exatas do TEXTO_BREVE (SAP)
-- =============================================

-- Limpa regras antigas
DELETE FROM public.regras_distribuicao;

-- ============================================================
-- REFRIGERACAO -> Suelem Silva
-- ============================================================
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade) VALUES
  ('AR CONDICIONADO (ATE 60.000 BTUS)', 'refrigeracao'),
  ('AR CONDICIONADO (VRF/CHILLER/SPLITAO)', 'refrigeracao'),
  ('MANUT.PREVENTIVA CENTRAIS DE AR', 'refrigeracao'),
  ('MANUTENCAO PREVENTIVA LIMPEZA AR-COND', 'refrigeracao'),
  ('MANUT. PREVENTIVA - CENTRAIS DE AR', 'refrigeracao'),
  ('CORRETIVA DO AR-CONDICIONADO', 'refrigeracao'),
  ('PREVENTIVA DO AR-CONDICONADO', 'refrigeracao'),
  ('FREEZER', 'refrigeracao'),
  ('TERMOMETRO DE GELADEIRA', 'refrigeracao'),
  -- Palavras-chave parciais como fallback
  ('AR CONDICIONADO', 'refrigeracao'),
  ('AR-CONDICIONADO', 'refrigeracao'),
  ('AR-COND', 'refrigeracao'),
  ('CENTRAIS DE AR', 'refrigeracao'),
  ('CHILLER', 'refrigeracao'),
  ('VRF', 'refrigeracao'),
  ('SPLITAO', 'refrigeracao'),
  ('GELADEIRA', 'refrigeracao'),
  ('REFRIGERACAO', 'refrigeracao'),
  ('BTUS', 'refrigeracao');

-- ============================================================
-- ELEVADORES/CRITICOS -> Gustavo Andrade + Paula Matos
-- ============================================================
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade) VALUES
  ('ELEVADOR', 'elevadores'),
  ('MANUT. PREVENTIVA/CORRET. NO ELEVADOR', 'elevadores'),
  ('MANUT.PREVENTIVA/CORRETIVA NO ELEVADOR', 'elevadores'),
  ('ESCADA ROLANTE', 'elevadores'),
  ('MANUT-PREVENTIVA ESCADA ROLANTE', 'elevadores'),
  ('MANUT-PREVENTIVA-ESCADA ROLANTE', 'elevadores'),
  ('SUBESTACAO', 'elevadores'),
  ('GERADOR', 'elevadores'),
  ('GRUPO GERADOR', 'elevadores'),
  ('MANUT. PREVENT-GRUPO GERADOR', 'elevadores'),
  ('MANUT.PREVENTIVA GRUPO GERADOR', 'elevadores'),
  ('MANUT. PREVENTIVA/CORRET.-GRUPO GERADOR', 'elevadores'),
  ('MANUT. PREVENT.GRUPO GERADOR', 'elevadores'),
  ('MANUT. PREVENTIVA - GRUPO GERADOR', 'elevadores'),
  ('MANUT. PREVENTIVA GRUPO GERADOR', 'elevadores'),
  ('MONTA CARGA', 'elevadores'),
  ('MANUT. PREVENTIVA NO MONTA CARGA', 'elevadores'),
  ('MANUT.PREVENTIVA MONTA CARGA_FARMA', 'elevadores'),
  ('MANUT. PREVENTIVA DA PLATAFORMA', 'elevadores'),
  ('MANUT. PREVENTIVA NO PLATAFORMA', 'elevadores');
