-- 00104_normalize_admin_emails_for_auth.sql
-- Normaliza emails de administradores para o fluxo de auth

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(trim(email)) AS email_normalizado
      FROM public.administradores
      GROUP BY 1
      HAVING COUNT(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Existem emails duplicados em public.administradores apos normalizacao. Corrija antes de aplicar esta migration.';
  END IF;
END
$$;

UPDATE public.administradores
SET
  email = lower(trim(email)),
  updated_at = now()
WHERE email IS DISTINCT FROM lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS administradores_email_normalizado_key
ON public.administradores (lower(trim(email)));
