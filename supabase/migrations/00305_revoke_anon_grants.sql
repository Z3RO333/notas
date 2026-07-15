-- 00305: Revoga todo acesso do role anon ao schema public (hardening).
--
-- Contexto: o role anon tinha SELECT/INSERT/UPDATE/DELETE/TRUNCATE em 71 tabelas
-- e EXECUTE em 56 funções SECURITY DEFINER — a chave anon vai no bundle do browser,
-- então qualquer pessoa sem login tinha acesso total via PostgREST.
--
-- Nenhum fluxo depende de anon em tabelas/funções:
--   - cockpit web: anon só para endpoints de auth (login/reset); dados sempre com sessão
--   - rota-platform mobile: auth + storage com sessão autenticada; dados via rota-api (service role)
--   - localizador e rota-api: service role
--   - jobs Databricks/scripts: service role
-- authenticated e service_role mantêm grants explícitos (verificado: 912/912 funções).
--
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- Já aplicada manualmente em produção em 2026-07-11 via MCP.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Tabelas e views (inclui objetos de extensão não-revogáveis por postgres, ex: spatial_ref_sys — skip)
  FOR r IN
    SELECT format('%I.%I', schemaname, tablename) AS obj FROM pg_tables WHERE schemaname = 'public'
    UNION ALL
    SELECT format('%I.%I', schemaname, viewname) FROM pg_views WHERE schemaname = 'public'
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.obj);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip tabela %: %', r.obj, SQLERRM;
    END;
  END LOOP;

  -- Sequences
  FOR r IN
    SELECT format('%I.%I', sequence_schema, sequence_name) AS obj
    FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', r.obj);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip seq %: %', r.obj, SQLERRM;
    END;
  END LOOP;

  -- Funções: revoga de anon e também do pseudo-role PUBLIC (o Postgres dá EXECUTE
  -- a PUBLIC por default, então revogar só de anon não bloquearia nada).
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.fn);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip fn %: %', r.fn, SQLERRM;
    END;
  END LOOP;
END $$;

-- Objetos futuros criados pelo role postgres (migrations/MCP) não ganham grants pra anon.
-- (Os default privileges do supabase_admin também incluem anon, mas são gerenciados
-- pela plataforma e postgres não tem permissão para alterá-los.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- Remove o grant explícito de USAGE no schema (PUBLIC ainda tem =U, então isso é
-- documentação de intenção — o bloqueio efetivo é a ausência de grants nos objetos).
REVOKE USAGE ON SCHEMA public FROM anon;
