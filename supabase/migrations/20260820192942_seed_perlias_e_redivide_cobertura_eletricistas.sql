-- 20260820200000_seed_perlias_e_redivide_cobertura_eletricistas.sql
--
-- Novo eletricista Perlias Lavor de Souza (codigo 23457). Redivide a cobertura de
-- lojas entre os 3 eletricistas (Claudiomar 22578, Otavio Luis 10262, Perlias 23457)
-- conforme nova distribuição definida pelo usuário.

INSERT INTO public.dim_operacionais (codigo, nome, especialidade)
VALUES ('23457', 'PERLIAS LAVOR DE SOUZA', 'eletricista')
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, especialidade = EXCLUDED.especialidade;

-- Claudiomar (22578) → Otavio Luis (10262): Cidade Nova / Farma Cidade Nova
UPDATE public.operacional_unidades
SET operacional_codigo = '10262'
WHERE operacional_codigo = '22578'
  AND unidade IN ('CIDADE NOVA', 'FARMA CIDADE NOVA');

-- Claudiomar (22578) → Perlias (23457): Educandos / Farma Educandos, Shopping Manauara / Farma Manauara
UPDATE public.operacional_unidades
SET operacional_codigo = '23457'
WHERE operacional_codigo = '22578'
  AND unidade IN ('BEMOL FARMA EDUCANDOS', 'EDUCANDOS', 'FARMA MANAUARA', 'SHOPPING MANAUARA');

-- Otavio Luis (10262) → Perlias (23457): Avenida, Grande Circular / Farma Grande Circular, Shopping Studio 5 / Farma Studio 5
UPDATE public.operacional_unidades
SET operacional_codigo = '23457'
WHERE operacional_codigo = '10262'
  AND unidade IN ('AVENIDA', 'FARMA GRANDE CIRCULAR', 'FARMA STUDIO 5', 'GRANDE CIRCULAR', 'SHOPPING STUDIO 5');
