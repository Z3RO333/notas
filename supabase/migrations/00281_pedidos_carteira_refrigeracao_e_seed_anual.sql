-- 00281_pedidos_carteira_refrigeracao_e_seed_anual.sql
--
-- 1. Permite que admins de especialidade='refrigeracao' (Suelém) também
--    sejam donos na carteira de fornecedores de Pedidos de Compra
--    (antes só admins gerais podiam).
-- 2. Seed dos fornecedores dos pedidos anuais 2026, conforme divisão
--    combinada com o gestor (mesma lógica da carteira PMPL: cada
--    especialista cuida dos fornecedores que já são "dele").

-- ============================================================
-- 1) Atualiza trigger de validação
-- ============================================================
CREATE OR REPLACE FUNCTION public.validar_carteira_fornecedor_admin_geral()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role user_role;
  v_especialidade TEXT;
BEGIN
  SELECT role, especialidade
  INTO v_role, v_especialidade
  FROM public.administradores
  WHERE id = NEW.administrador_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Administrador não encontrado: %', NEW.administrador_id;
  END IF;

  IF v_role <> 'admin' OR v_especialidade NOT IN ('geral', 'refrigeracao') THEN
    RAISE EXCEPTION
      'Carteira de fornecedores de Pedidos de Compra só pode ser atribuída a administradores gerais ou de refrigeração (role=admin, especialidade in (geral, refrigeracao)). Administrador % tem role=% e especialidade=%.',
      NEW.administrador_id, v_role, v_especialidade;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validar_carteira_fornecedor_admin_geral IS
  'Garante no nível de banco que apenas administradores gerais ou de refrigeração (role=admin, especialidade in (geral, refrigeracao)) podem ser donos de fornecedores na carteira de Pedidos de Compra.';

-- ============================================================
-- 2) Seed dos fornecedores dos pedidos anuais 2026
-- ============================================================
DO $$
DECLARE
  v_paula   UUID;
  v_mayky   UUID;
  v_rosana  UUID;
  v_fabiola UUID;
  v_wander  UUID;
  v_suelem  UUID;
  v_walter  UUID;
BEGIN
  SELECT id INTO v_paula   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_mayky   FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_rosana  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_wander  FROM public.administradores WHERE email = 'wanderluciomendes@bemol.com.br';
  SELECT id INTO v_suelem  FROM public.administradores WHERE email = 'suelemsilva@bemol.com.br';
  SELECT id INTO v_walter  FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';

  IF v_paula   IS NULL THEN RAISE EXCEPTION 'Admin Paula não encontrada';   END IF;
  IF v_mayky   IS NULL THEN RAISE EXCEPTION 'Admin Mayky não encontrado';   END IF;
  IF v_rosana  IS NULL THEN RAISE EXCEPTION 'Admin Rosana não encontrada';  END IF;
  IF v_fabiola IS NULL THEN RAISE EXCEPTION 'Admin Fabíola não encontrada'; END IF;
  IF v_wander  IS NULL THEN RAISE EXCEPTION 'Admin Wanderlucio não encontrado'; END IF;
  IF v_suelem  IS NULL THEN RAISE EXCEPTION 'Admin Suelém não encontrada'; END IF;
  IF v_walter  IS NULL THEN RAISE EXCEPTION 'Admin Walter (autor do seed) não encontrado'; END IF;

  INSERT INTO public.pedidos_compra_carteira_fornecedor
    (fornecedor_codigo, fornecedor_nome, administrador_id, created_by, updated_by)
  VALUES
    -- Rosana: elevadores/pragas/incêndio/água, mesma divisão da carteira PMPL
    ('41',    'ELEVADORES ATLAS S/A',                      v_rosana,  v_walter, v_walter),
    ('15327', 'EVANCLEY S. DE MELO - ME',                  v_rosana,  v_walter, v_walter),
    ('500',   'FABITECK SANEAMENTO LTDA',                  v_rosana,  v_walter, v_walter),
    ('9331',  'C&SERVICE',                                 v_rosana,  v_walter, v_walter),
    ('17162', 'C.E.S MELO',                                v_rosana,  v_walter, v_walter),
    ('9214',  'J I PINTO DOS SANTOS ME',                   v_rosana,  v_walter, v_walter),
    ('12034', 'MODULO ENGENHARIA CONSULTORIA E GERENCIA',  v_rosana,  v_walter, v_walter),
    ('10745', 'BIOTECH SOLUCOES EM BIOTECONOLOGIA LTDA',   v_rosana,  v_walter, v_walter),

    -- Paula: elevadores/gerador/pragas/bromatologia, mesma divisão da carteira PMPL
    ('16904', 'ERINALDO MARINHO RIBEIRO - ME (LUCAR)',     v_paula,   v_walter, v_walter),
    ('672',   'THYSSENKRUPP ELEVADORES S/A',               v_paula,   v_walter, v_walter),
    ('15594', 'PROTECTA TECNOLOGIA',                       v_paula,   v_walter, v_walter),
    ('13851', 'LABORATORIO HESSEL PERIN LTDA',             v_paula,   v_walter, v_walter),
    ('17017', 'BEATRIZ DE OLIVEIRA SILVA - ME',            v_paula,   v_walter, v_walter),
    ('1188',  'LUPA ANALISES BROMATOLOGICAS LTDA',         v_paula,   v_walter, v_walter),
    ('14604', 'MAKARIOS EMPREENDIMENTO',                   v_paula,   v_walter, v_walter),

    -- Fabíola: dedetização/elevadores/água
    ('13400', 'THYSSENKRUPP ELEVADORES SA',                v_fabiola, v_walter, v_walter),
    ('16513', 'AMAZONTEC SOLUCOES',                        v_fabiola, v_walter, v_walter),
    ('15202', 'SERVICOS DE DEDETIZACAO',                   v_fabiola, v_walter, v_walter),
    ('16119', 'PARINTINS CONTROLE DE PRAGAS',              v_fabiola, v_walter, v_walter),
    ('12697', 'QUALYANALISE AMBIENTAL SERVICOS DE TESTE',  v_fabiola, v_walter, v_walter),
    ('11371', 'FERREIRA E FERREIRA COMERCIO E SERVICOS',   v_fabiola, v_walter, v_walter),
    ('6405',  'ELEVADORES OTIS LTDA',                      v_fabiola, v_walter, v_walter),

    -- Wanderlucio: pragas/ETE/elétrica
    ('8059',  'EMOPS CONTROLE AMBIENTAL LTDA EPP',         v_wander,  v_walter, v_walter),
    ('10364', 'NASCIMENTO E CORDEIRO LTDA - ME',           v_wander,  v_walter, v_walter),
    ('16744', 'E. O. SOUZA',                               v_wander,  v_walter, v_walter),
    ('7949',  'ACQUALIMP PRODUTOS QUIMICOS LTDA - ME',     v_wander,  v_walter, v_walter),

    -- Mayky: gerador/subestação
    ('101',   'CLAUDIO ANDRADE JUNIOR (PRESTEM)',          v_mayky,   v_walter, v_walter),

    -- Suelém: refrigeração
    ('9542',  'HVAC',                                      v_suelem,  v_walter, v_walter),
    ('17753', 'THERMOCLEAN',                               v_suelem,  v_walter, v_walter),
    ('12171', 'TOTAL FRIO',                                v_suelem,  v_walter, v_walter),
    ('10070', 'PANTANAL',                                  v_suelem,  v_walter, v_walter),
    ('10295', 'ARTICO INSTALACOES',                        v_suelem,  v_walter, v_walter),
    ('15738', 'MARCIANO',                                  v_suelem,  v_walter, v_walter),
    ('14897', 'SUBZERO CLIMATIZACAO',                      v_suelem,  v_walter, v_walter),
    ('12029', 'TEKIOS',                                    v_suelem,  v_walter, v_walter),
    ('13379', 'JACSON RODRIGUES',                          v_suelem,  v_walter, v_walter),
    ('15363', 'K YAMAGUCHI COMERCIO',                      v_suelem,  v_walter, v_walter),
    ('18053', 'JARU REFRIGERACAO',                         v_suelem,  v_walter, v_walter)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        fornecedor_nome  = EXCLUDED.fornecedor_nome,
        updated_at       = now(),
        updated_by       = EXCLUDED.updated_by;

  RAISE NOTICE 'Seed: fornecedores dos pedidos anuais 2026 inseridos/atualizados na carteira de Pedidos de Compra.';
END;
$$;
