-- 00328_fix_thais_email_gestao_incendio.sql
--
-- A migration 00323 cadastrou o email secundário do perfil compartilhado
-- "Gestão de Incêndio" com erro de digitação: thaisfreitas@bemol.com.br.
-- O email real da Thaís é thaisandrade@bemol.com.br, o que a impedia de
-- logar (vw_administrador_por_email não encontrava o email dela).

UPDATE public.administrador_emails
SET email = 'thaisandrade@bemol.com.br'
WHERE email = 'thaisfreitas@bemol.com.br';

INSERT INTO public.administrador_emails (administrador_id, email)
SELECT id, 'thaisandrade@bemol.com.br'
FROM public.administradores
WHERE email = 'maurapantoja@bemol.com.br'
AND NOT EXISTS (
  SELECT 1 FROM public.administrador_emails WHERE email = 'thaisandrade@bemol.com.br'
)
ON CONFLICT (email) DO NOTHING;
