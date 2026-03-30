-- 00204_add_viewer_role_ordens_tv.sql
--
-- Cria o papel "viewer" para uso em telas de transmissao/TV.
--
-- IMPORTANTE:
-- Em Postgres, novos valores de enum nao podem ser usados no mesmo commit
-- em que sao criados. Por isso esta migration adiciona apenas o valor no
-- enum; o backfill da conta viewer fica na migration seguinte.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role'
      AND e.enumlabel = 'viewer'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'viewer';
  END IF;
END;
$$;
