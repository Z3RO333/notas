-- 00314_enable_rls_and_lock_public_schema.sql
--
-- Estado final de segurança após o cutover do Cockpit para Entra ID:
--   1. toda tabela do schema public fica com RLS habilitado;
--   2. anon/authenticated não acessam diretamente objetos public;
--   3. o Cockpit e a rota-api continuam acessando com service_role;
--   4. os clientes do rota-platform preservam Auth, Storage e Realtime nos
--      schemas rota/integration, que não são alterados por esta migration.
--
-- Esta migration encerra o acesso do Cockpit antigo por Supabase Auth. Aplicar
-- de forma coordenada com o deploy da versão Entra, após a migration 00313.

DO $$
BEGIN
  IF to_regprocedure('public.marcar_nota_em_geracao_service(uuid,uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.buscar_ordens_fornecedor_global_service(text,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'RPCs service_role da migration 00313 não encontradas; hardening abortado.';
  END IF;
END $$;

-- Remove os contratos legados que resolviam identidade por auth.uid().
DROP FUNCTION IF EXISTS public.marcar_nota_em_geracao(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.buscar_ordens_fornecedor_global(text, uuid, integer);

DO $$
DECLARE
  r RECORD;
BEGIN
  -- RLS em todas as tabelas comuns e particionadas da aplicação. Tabelas que
  -- pertencem formalmente a extensões (por exemplo, PostGIS) ficam fora deste
  -- loop porque seu lifecycle e ownership pertencem à extensão.
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS obj
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.obj);
  END LOOP;

  -- Tabelas, views e foreign tables da aplicação: nenhuma leitura/escrita
  -- direta por anon/authenticated. Objetos pertencentes a extensões ficam fora.
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS obj
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', r.obj);
  END LOOP;

  -- Sequences da aplicação no schema public.
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS obj
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', r.obj);
  END LOOP;

  -- Funções da aplicação, inclusive SECURITY DEFINER. Grants de service_role
  -- permanecem; funções pertencentes a extensões ficam sob gestão da extensão.
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
  END LOOP;
END $$;

-- Objetos futuros criados por migrations do role postgres não recebem grants
-- implícitos para os clientes. Novas tabelas public também devem habilitar RLS
-- explicitamente na própria migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Postcondition fail-closed: a migration não pode ser registrada como aplicada
-- se sobrar tabela sem RLS ou privilege efetivo de anon/authenticated em objeto
-- da aplicação (inclusive privilege herdado de PUBLIC).
DO $$
DECLARE
  v_without_rls INTEGER;
  v_relation_grants INTEGER;
  v_sequence_grants INTEGER;
  v_function_grants INTEGER;
BEGIN
  SELECT count(*)
  INTO v_without_rls
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    );

  SELECT count(*)
  INTO v_relation_grants
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
    AND (
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    );

  SELECT count(*)
  INTO v_sequence_grants
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind = 'S'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
    AND (
      has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
      OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
    );

  SELECT count(*)
  INTO v_function_grants
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF v_without_rls > 0
     OR v_relation_grants > 0
     OR v_sequence_grants > 0
     OR v_function_grants > 0 THEN
    RAISE EXCEPTION
      'hardening incompleto: sem_rls=%, relations=%, sequences=%, functions=%',
      v_without_rls, v_relation_grants, v_sequence_grants, v_function_grants;
  END IF;
END $$;

-- Reafirma os dois contratos permitidos após o revoke amplo de funções.
GRANT EXECUTE ON FUNCTION public.marcar_nota_em_geracao_service(uuid, uuid, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.buscar_ordens_fornecedor_global_service(text, uuid, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
