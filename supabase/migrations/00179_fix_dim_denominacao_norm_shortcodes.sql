-- 00179_fix_dim_denominacao_norm_shortcodes.sql
--
-- Problema: o KPI de "Lojas" mostrava 78 unidades quando a Bemol tem ~38 lojas.
-- Causa: muitas ordens gravam apenas o shortcode em `unidade` (ex: "CAMAPUA")
-- sem preencher `denominacao_unidade`. A tabela dim_denominacao_norm não tinha
-- mapeamento para esses shortcodes, então cada um virava uma "loja" separada
-- duplicando o canônico (ex: "CAMAPUA" + "Loja Camapuã" = 2 entradas).
-- Também inclui variantes "Bemol X" e entidades não-lojas (escritórios).
--
-- Fix:
-- 1) Permite tipo 'ESCRITORIO' no check constraint
-- 2) Mapeia ~40 shortcodes maiúsculos para seus nomes canônicos
-- 3) Mapeia variantes "Bemol X" para o canônico correto
-- 4) Classifica unidades administrativas como ESCRITORIO (excluídas dos KPIs)

-- ---------------------------------------------------------------------------
-- 1. Expande o CHECK constraint para incluir ESCRITORIO
-- ---------------------------------------------------------------------------
ALTER TABLE public.dim_denominacao_norm
  DROP CONSTRAINT IF EXISTS dim_denominacao_norm_tipo_unidade_override_check;

ALTER TABLE public.dim_denominacao_norm
  ADD CONSTRAINT dim_denominacao_norm_tipo_unidade_override_check
  CHECK (tipo_unidade_override IN ('LOJA', 'CD', 'FARMA', 'ESCRITORIO'));

-- ---------------------------------------------------------------------------
-- 2. Shortcodes maiúsculos → nome canônico (LOJA)
--    Cada shortcode abaixo aparecia no banco sem mapeamento, criando entradas
--    duplicadas ao lado das entradas com denominacao_unidade preenchida.
-- ---------------------------------------------------------------------------
INSERT INTO public.dim_denominacao_norm (raw_nome, nome_canonical, tipo_unidade_override)
VALUES
  -- Lojas com shortcode ≠ nome canônico
  ('CAMAPUA',               'Loja Camapuã',              'LOJA'),
  ('AVENIDA',               'Loja Avenida',              'LOJA'),
  ('EDUCANDOS',             'Loja Educandos',            'LOJA'),
  ('CIDADE NOVA',           'Loja Cidade Nova',          'LOJA'),
  ('GETULIO VARGAS',        'Loja Getúlio Vargas',       'LOJA'),
  ('GRANDE CIRCULAR',       'Loja Grande Circular',      'LOJA'),
  ('IRANDUBA',              'Loja Iranduba',             'LOJA'),
  ('ITACOATIARA',           'Loja Itacoatiara',          'LOJA'),
  ('JATUARANA',             'Loja Jatuarana',            'LOJA'),
  ('MANACAPURU',            'Loja Manacapuru',           'LOJA'),
  ('MAJOR WILLIAMS',        'Loja Major Williams',       'LOJA'),
  ('NOVA CIDADE',           'Loja Nova Cidade',          'LOJA'),
  ('PARINTINS',             'Loja Parintins',            'LOJA'),
  ('PONTA NEGRA',           'Loja Ponta Negra',          'LOJA'),
  ('PRESIDENTE FIGUEIREDO', 'Loja Presidente Figueiredo','LOJA'),
  ('RIO BRANCO',            'Loja Rio Branco',           'LOJA'),
  ('TORQUATO',              'Loja Torquato',             'LOJA'),
  ('ARIQUEMES',             'Loja Ariquemes',            'LOJA'),
  ('CAREIRO',               'Loja Careiro',              'LOJA'),
  ('COARI',                 'Loja Coari',                'LOJA'),
  ('MANAQUIRI',             'Loja Manaquiri',            'LOJA'),
  ('JI-PARANA',             'Loja Ji-Paraná',            'LOJA'),
  ('AUTAZES',               'Loja Autazes',              'LOJA'),
  ('CODAJAS',               'Loja Codajás',              'LOJA'),
  ('CRUZEIRO DO SUL',       'Loja Cruzeiro do Sul',      'LOJA'),
  ('MAUES',                 'Loja Maués',                'LOJA'),
  ('RIO PRETO',             'Loja Rio Preto da Eva',     'LOJA'),
  ('ATAIDE TEIVE',          'Loja Ataide Teive',         'LOJA'),
  ('RORAINOPOLIS',          'Loja Rorainópolis',         'LOJA'),
  ('AMAZONAS SHOPPING',     'Loja Amazonas Shopping',    'LOJA'),

  -- Nomes com acento (denominacao_unidade) → canônico
  ('Loja Camapuã',          'Loja Camapuã',              'LOJA'),
  ('Loja Autazes',          'Loja Autazes',              'LOJA'),
  ('Loja Ariquemes',        'Loja Ariquemes',            'LOJA'),
  ('Loja Coari',            'Loja Coari',                'LOJA'),
  ('Loja Careiro',          'Loja Careiro',              'LOJA'),
  ('Loja Avenida',          'Loja Avenida',              'LOJA'),
  ('Loja Educandos',        'Loja Educandos',            'LOJA'),
  ('Loja Cidade Nova',      'Loja Cidade Nova',          'LOJA'),
  ('Loja Getúlio Vargas',   'Loja Getúlio Vargas',       'LOJA'),
  ('Loja Grande Circular',  'Loja Grande Circular',      'LOJA'),
  ('Loja Iranduba',         'Loja Iranduba',             'LOJA'),
  ('Loja Itacoatiara',      'Loja Itacoatiara',          'LOJA'),
  ('Loja Jatuarana',        'Loja Jatuarana',            'LOJA'),
  ('Loja Major Williams',   'Loja Major Williams',       'LOJA'),
  ('Loja Manacapuru',       'Loja Manacapuru',           'LOJA'),
  ('Loja Manaquiri',        'Loja Manaquiri',            'LOJA'),
  ('Loja Nova Cidade',      'Loja Nova Cidade',          'LOJA'),
  ('Loja Parintins',        'Loja Parintins',            'LOJA'),
  ('Loja Ponta Negra',      'Loja Ponta Negra',          'LOJA'),
  ('Loja Presidente Figueiredo', 'Loja Presidente Figueiredo', 'LOJA'),
  ('Loja Pres. Figueiredo', 'Loja Presidente Figueiredo','LOJA'),
  ('Loja Rio Branco',       'Loja Rio Branco',           'LOJA'),
  ('Loja Rio Preto da Eva', 'Loja Rio Preto da Eva',     'LOJA'),
  ('Loja Torquato',         'Loja Torquato',             'LOJA'),
  ('Loja Ji-Paraná',        'Loja Ji-Paraná',            'LOJA'),
  ('Loja Codajás',          'Loja Codajás',              'LOJA'),
  ('Loja Cruzeiro do Sul',  'Loja Cruzeiro do Sul',      'LOJA'),
  ('Loja Maués',            'Loja Maués',                'LOJA'),
  ('Loja Ataide Teive',     'Loja Ataide Teive',         'LOJA'),
  ('Loja Rorainopolis',     'Loja Rorainópolis',         'LOJA'),
  ('Loja Rorainópolis',     'Loja Rorainópolis',         'LOJA'),
  ('Loja Amazonas Shopping','Loja Amazonas Shopping',    'LOJA'),

  -- Variantes "Bemol X" → canônico de loja
  ('Bemol Ataide Teive',    'Loja Ataide Teive',         'LOJA'),
  ('BEMOL ITACOATIARA',     'Loja Itacoatiara',          'LOJA'),
  ('BEMOL TORQUATO',        'Loja Torquato',             'LOJA'),

  -- Variante "LJ X"
  ('LJ STUDIO 5',           'Loja Studio 5',             'LOJA'),

  -- Lojas de shopping já mapeadas — garante canônico também
  ('Loja Manauara',         'Loja Manauara',             'LOJA'),
  ('Loja Studio 5',         'Loja Studio 5',             'LOJA'),
  ('Loja Shopping Ponta Negra', 'Loja Shopping Ponta Negra', 'LOJA'),
  ('Loja Boa Vista Shopping',   'Loja Boa Vista Shopping',   'LOJA'),
  ('Loja Shopping Millennium',  'Loja Shopping Millennium',  'LOJA'),

  -- Loterias Bemol (tratadas como LOJA por enquanto)
  ('Loteria Cidade Nova',          'Loteria Cidade Nova',         'LOJA'),
  ('Loteria Porto Velho Centro',   'Loteria Porto Velho Centro',  'LOJA'),

  -- ---------------------------------------------------------------------------
  -- Unidades administrativas — ESCRITORIO (excluídas dos KPIs de lojas)
  -- ---------------------------------------------------------------------------
  ('Escritório Central',          'Escritório Central',          'ESCRITORIO'),
  ('Escritório Central Anexo I',  'Escritório Central Anexo I',  'ESCRITORIO'),
  ('Escritorio Central',          'Escritório Central',          'ESCRITORIO'),
  ('ESCRITORIO CENTRAL',          'Escritório Central',          'ESCRITORIO'),
  ('Call Center',                 'Call Center',                 'ESCRITORIO'),
  ('CALL CENTER',                 'Call Center',                 'ESCRITORIO'),
  ('Contabilidade',               'Contabilidade',               'ESCRITORIO'),
  ('CONTABILIDADE',               'Contabilidade',               'ESCRITORIO'),
  ('Informática',                 'Informática',                 'ESCRITORIO'),
  ('INFORMATICA',                 'Informática',                 'ESCRITORIO'),
  ('Informática - TI',            'Informática',                 'ESCRITORIO'),
  ('TI',                          'Informática',                 'ESCRITORIO')

ON CONFLICT (raw_nome) DO UPDATE
  SET nome_canonical        = EXCLUDED.nome_canonical,
      tipo_unidade_override = EXCLUDED.tipo_unidade_override;
