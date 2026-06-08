-- Migration 00272: Tabela de contatos por unidade para alertas de manutenção
-- Armazena emails dos responsáveis (gerentes de loja, farmacêuticos) por centro SAP.

CREATE TABLE IF NOT EXISTS public.contatos_unidade (
  centro         text PRIMARY KEY,
  nome_unidade   text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('LOJA', 'FARMA', 'CD')),
  emails         text[] NOT NULL DEFAULT '{}',
  ativo          boolean NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contatos_unidade_tipo ON public.contatos_unidade (tipo);
CREATE INDEX IF NOT EXISTS idx_contatos_unidade_ativo ON public.contatos_unidade (ativo);

COMMENT ON TABLE public.contatos_unidade IS
  'Contatos por unidade (centro SAP) para envio de alertas automáticos de manutenção.';

-- ============================================================
-- LOJAS
-- ============================================================
INSERT INTO public.contatos_unidade (centro, nome_unidade, tipo, emails) VALUES
  ('101', 'Loja Matriz',                  'LOJA', ARRAY['gerenciabemolmatriz@bemol.com.br']),
  ('103', 'Loja Avenida',                 'LOJA', ARRAY['gerenciabemolavenida@bemol.com.br']),
  ('105', 'Loja Educandos',               'LOJA', ARRAY['gerenciabemoleducandos@bemol.com.br']),
  ('106', 'Loja Amazonas Shopping',       'LOJA', ARRAY['gerenciabemolshopping@bemol.com.br']),
  ('109', 'Loja Grande Circular',         'LOJA', ARRAY['gerenciabemolgrandecircular@bemol.com.br']),
  ('114', 'Loja Ponta Negra',             'LOJA', ARRAY['gerenciabemolpontanegra@bemol.com.br']),
  ('115', 'Loja Cidade Nova',             'LOJA', ARRAY['gerenciabemolcidadenova@bemol.com.br']),
  ('116', 'Loja Studio 5',                'LOJA', ARRAY['gerenciabemolstudio5@bemol.com.br']),
  ('118', 'Loja Camapua',                 'LOJA', ARRAY['gerenciabemolcamapua@bemol.com.br']),
  ('119', 'Loja Manauara',                'LOJA', ARRAY['gerenciabemolmanauara@bemol.com.br']),
  ('120', 'Loja Shopping Ponta Negra',    'LOJA', ARRAY['gerenciabemolpnshopping@bemol.com.br']),
  ('121', 'Loja Nova Cidade',             'LOJA', ARRAY['gerenciabemolnovacidade@bemol.com.br']),
  ('201', 'Loja Porto Velho Centro',      'LOJA', ARRAY['gerenciabemolpvhcentro@bemol.com.br']),
  ('202', 'Loja Porto Velho Shopping',    'LOJA', ARRAY['gerenciabemolportovelhoshp@bemol.com.br']),
  ('204', 'Loja Jatuarana',               'LOJA', ARRAY['gerenciabemoljatuarana@bemol.com.br']),
  ('205', 'Loja Ji-Parana',               'LOJA', ARRAY['gerenciabemoljiparana@bemol.com.br']),
  ('206', 'Loja Ariquemes',               'LOJA', ARRAY['gerenciabemolariquemes@bemol.com.br']),
  ('401', 'Loja Rio Branco',              'LOJA', ARRAY['gerenciabemolriobranco@bemol.com.br']),
  ('404', 'Loja Cruzeiro do Sul',         'LOJA', ARRAY['gerenciabemolcruzeirodosul@bemol.com.br']),
  ('500', 'Loja Torquato',                'LOJA', ARRAY['gerenciabemoltorquato@bemol.com.br']),
  ('510', 'Loja Itacoatiara',             'LOJA', ARRAY['gerenciabemolitacoatiara@bemol.com.br']),
  ('520', 'Loja Manacapuru',              'LOJA', ARRAY['gerenciamanacapuru@bemol.com.br', 'gerenciabemolmanacapuru@bemol.com.br']),
  ('530', 'Loja Presidente Figueiredo',   'LOJA', ARRAY['gerenciabemolpresidentefigueiredo@bemol.com.br']),
  ('531', 'Loja Autazes',                 'LOJA', ARRAY['gerenciabemolautazes@bemol.com.br']),
  ('550', 'Loja Iranduba',                'LOJA', ARRAY['gerenciabemoliranduba@bemol.com.br']),
  ('560', 'Loja Rio Preto da Eva',        'LOJA', ARRAY['gerenciabemolriopretodaeva@bemol.com.br']),
  ('561', 'Loja Codajas',                 'LOJA', ARRAY['gerenciabemolcodajas@bemol.com.br']),
  ('570', 'Loja Manaquiri',               'LOJA', ARRAY['gerenciabemolmanaquiri@bemol.com.br']),
  ('580', 'Loja Careiro',                 'LOJA', ARRAY['gerenciabemolcareirocastanho@bemol.com.br']),
  ('590', 'Loja Parintins',               'LOJA', ARRAY['gerenciabemolparintins@bemol.com.br']),
  ('591', 'Loja Coari',                   'LOJA', ARRAY['gerenciabemolcoari@bemol.com.br']),
  ('592', 'Loja Maues',                   'LOJA', ARRAY['gerenciabemolmaues@bemol.com.br']),
  ('701', 'Loja Boa Vista Shopping',      'LOJA', ARRAY['gerenciabemolboavista@bemol.com.br']),
  ('702', 'Loja Ataide Teive',            'LOJA', ARRAY['gerenciabemolataide@bemol.com.br']),
  ('703', 'Loja Rorainopolis',            'LOJA', ARRAY['gerenciabemolrorainopolis@bemol.com.br']),
  ('705', 'Loja Getulio Vargas',          'LOJA', ARRAY['gerenciabemolgetuliovargas@bemol.com.br']),
  ('706', 'Loja Major Williams',          'LOJA', ARRAY['gerenciamajorwilliams@bemol.com.br'])
ON CONFLICT (centro) DO UPDATE SET
  nome_unidade  = EXCLUDED.nome_unidade,
  tipo          = EXCLUDED.tipo,
  emails        = EXCLUDED.emails,
  atualizado_em = now();

-- ============================================================
-- FARMAS
-- ============================================================
INSERT INTO public.contatos_unidade (centro, nome_unidade, tipo, emails) VALUES
  ('601', 'Farma Torquato',               'FARMA', ARRAY['farmaceuticostorquato@bemol.com.br']),
  ('602', 'Farma Camapua',                'FARMA', ARRAY['farmaceuticoscamapua@bemol.com.br']),
  ('603', 'Farma Amazonas Shopping',      'FARMA', ARRAY['farmaceuticosshopping@bemol.com.br']),
  ('604', 'Farma Grande Circular',        'FARMA', ARRAY['farmaceuticosgrandecircular@bemol.com.br']),
  ('605', 'Farma Matriz',                 'FARMA', ARRAY['farmaceuticosmatriz@bemol.com.br']),
  ('606', 'Farma Shopping Ponta Negra',   'FARMA', ARRAY['farmaceuticosshoppingspn@bemol.com.br']),
  ('607', 'Farma Nova Cidade',            'FARMA', ARRAY['farmaceuticosnovacidade@bemol.com.br']),
  ('612', 'Farma Manauara',               'FARMA', ARRAY['farmaceuticosmanauara@bemol.com.br']),
  ('614', 'Farma Presidente Figueiredo',  'FARMA', ARRAY['farmaceuticospresidentefigueiredo@bemol.com.br']),
  ('615', 'Farma Djalma',                 'FARMA', ARRAY['farmaceuticosdjalma@bemol.com.br']),
  ('617', 'Farma Ponta Negra DB',         'FARMA', ARRAY['farmaceuticospontanegradb@bemol.com.br']),
  ('618', 'Farma Studio 5',               'FARMA', ARRAY['farmaceuticosstudio5@bemol.com.br']),
  ('620', 'Farma Avenida',                'FARMA', ARRAY['farmaceuticosavenida@bemol.com.br']),
  ('621', 'Farma Cidade Nova',            'FARMA', ARRAY['farmaceuticoscidadenova@bemol.com.br']),
  ('622', 'Farma Autazes',                'FARMA', ARRAY['farmaceuticosautazes@bemol.com.br']),
  ('623', 'Farma Ataide Teive',           'FARMA', ARRAY['farmaceuticosataideteive@bemol.com.br']),
  ('624', 'Farma Manacapuru',             'FARMA', ARRAY['farmaceuticosmanacapuru@bemol.com.br']),
  ('629', 'Farma Rio Preto',              'FARMA', ARRAY['farmaceuticosriopreto@bemol.com.br']),
  ('633', 'Farma Manaquiri',              'FARMA', ARRAY['farmaceuticosmanaquiri@bemol.com.br']),
  ('636', 'Farma Dom Pedro',              'FARMA', ARRAY['farmaceuticosdompedro@bemol.com.br']),
  ('637', 'Farma Boulevard',              'FARMA', ARRAY['farmaceuticosboulevard@bemol.com.br']),
  ('639', 'Farma Parintins',              'FARMA', ARRAY['farmaceuticosparintins@bemol.com.br']),
  ('640', 'Farma Coari',                  'FARMA', ARRAY['farmaceuticoscoari@bemol.com.br']),
  ('642', 'Farma Via Norte',              'FARMA', ARRAY['farmaceuticosvianorte@bemol.com.br']),
  ('643', 'Farma Efigenio Salles',        'FARMA', ARRAY['farmaceuticosefigeniosalles@bemol.com.br']),
  ('644', 'Farma Franceses',              'FARMA', ARRAY['farmaceuticosfranceses@bemol.com.br']),
  ('645', 'Farma Coroado',                'FARMA', ARRAY['farmaceuticoscoroado@bemol.com.br']),
  ('647', 'Farma Av. das Torres',         'FARMA', ARRAY['farmaceuticostorres@bemol.com.br']),
  ('648', 'Farma Noel Nutels',            'FARMA', ARRAY['farmaceuticosnoelnutels@bemol.com.br']),
  ('649', 'Farma Flores',                 'FARMA', ARRAY['farmaceuticosflores@bemol.com.br']),
  ('699', 'Farma Torres Online',          'FARMA', ARRAY['farmaceuticostorres@bemol.com.br'])
ON CONFLICT (centro) DO UPDATE SET
  nome_unidade  = EXCLUDED.nome_unidade,
  tipo          = EXCLUDED.tipo,
  emails        = EXCLUDED.emails,
  atualizado_em = now();

-- ============================================================
-- CDs (sem contato definido por enquanto)
-- ============================================================
INSERT INTO public.contatos_unidade (centro, nome_unidade, tipo, emails) VALUES
  ('148', 'CD Taruma',      'CD', ARRAY[]::text[]),
  ('104', 'CD Manaus',      'CD', ARRAY[]::text[]),
  ('203', 'CD Porto Velho', 'CD', ARRAY['gerenciabemolcdpvh@bemol.com.br']),
  ('704', 'CD Boa Vista',   'CD', ARRAY[]::text[]),
  ('402', 'CD Rio Branco',  'CD', ARRAY['gerenciabemolriobranco@bemol.com.br'])
ON CONFLICT (centro) DO UPDATE SET
  nome_unidade  = EXCLUDED.nome_unidade,
  tipo          = EXCLUDED.tipo,
  emails        = EXCLUDED.emails,
  atualizado_em = now();
