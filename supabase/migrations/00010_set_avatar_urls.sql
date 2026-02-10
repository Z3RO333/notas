-- =============================================
-- MIGRATION 00010: Set avatar URLs for admins
-- =============================================

UPDATE public.administradores SET avatar_url = '/avatars/suelemsilva.jpeg' WHERE email = 'suelemsilva@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/gustavoandrade.jpg' WHERE email = 'gustavoandrade@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/paulamatos.jpg' WHERE email = 'paulamatos@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/wanderluciomendes.jpeg' WHERE email = 'wanderluciomendes@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/rosanafigueira.jpeg' WHERE email = 'rosanafigueira@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/maykycastro.jpeg' WHERE email = 'maykycastro@bemol.com.br';
UPDATE public.administradores SET avatar_url = '/avatars/fabiolatentunge.jpeg' WHERE email = 'fabiolatentunge@bemol.com.br';
