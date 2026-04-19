-- 00236_operacional_unidades.sql
-- Mapeia quais unidades (lojas) cada operacional é responsável por cobrir.

CREATE TABLE IF NOT EXISTS public.operacional_unidades (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operacional_codigo  TEXT        NOT NULL REFERENCES public.dim_operacionais(codigo) ON DELETE CASCADE,
  unidade             TEXT        NOT NULL,
  grupo_nome          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operacional_codigo, unidade)
);

COMMENT ON TABLE public.operacional_unidades IS
  'Mapeamento das lojas/unidades atendidas por cada operacional (eletricista, etc.).';

ALTER TABLE public.operacional_unidades DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_operacional_unidades_codigo
  ON public.operacional_unidades (operacional_codigo);

-- Seed: cobertura inicial de Edeson, Claudiomar e Luiz
-- Edeson Monteiro Sousa (22016) — Centro-Sul e Zona Leste
INSERT INTO public.operacional_unidades (operacional_codigo, unidade, grupo_nome) VALUES
  ('22016', 'MATRIZ',              'Centro-Sul e Zona Leste'),
  ('22016', 'AVENIDA',             'Centro-Sul e Zona Leste'),
  ('22016', 'EDUCANDOS',           'Centro-Sul e Zona Leste'),
  ('22016', 'SHOPPING STUDIO 5',   'Centro-Sul e Zona Leste'),
  ('22016', 'AMAZONAS SHOPPING',   'Centro-Sul e Zona Leste')
ON CONFLICT (operacional_codigo, unidade) DO NOTHING;

-- Claudiomar Lopes da Silva (22578) — Oeste / Norte / Zona Rural
INSERT INTO public.operacional_unidades (operacional_codigo, unidade, grupo_nome) VALUES
  ('22578', 'PONTA NEGRA',         'Oeste / Norte / Zona Rural'),
  ('22578', 'IRANDUBA',            'Oeste / Norte / Zona Rural'),
  ('22578', 'CD TARUMA',           'Oeste / Norte / Zona Rural'),
  ('22578', 'SHOPPING PONTA NEGRA','Oeste / Norte / Zona Rural'),
  ('22578', 'TORQUATO',            'Oeste / Norte / Zona Rural')
ON CONFLICT (operacional_codigo, unidade) DO NOTHING;

-- Otavio Luis Medeiros de Azevedo (10262) — Norte / Leste
INSERT INTO public.operacional_unidades (operacional_codigo, unidade, grupo_nome) VALUES
  ('10262', 'CIDADE NOVA',         'Norte / Leste'),
  ('10262', 'GRANDE CIRCULAR',     'Norte / Leste'),
  ('10262', 'CAMAPUA',             'Norte / Leste'),
  ('10262', 'NOVA CIDADE',         'Norte / Leste'),
  ('10262', 'SHOPPING MANAUARA',   'Norte / Leste')
ON CONFLICT (operacional_codigo, unidade) DO NOTHING;
