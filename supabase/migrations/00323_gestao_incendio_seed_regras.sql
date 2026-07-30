-- 00323_gestao_incendio_seed_regras.sql
--
-- Reocupa a especialidade 'criticos' (órfã desde a saída do Mazurkevs) com um
-- perfil compartilhado acessado por múltiplos logins. Corrige duas
-- palavras-chave de regras_distribuicao que afetam diretamente essa fila:
--   1. 'ALARME DE INCENDIO' sem acento não bate com textos reais acentuados.
--   2. 'MANGUEIRA' sozinha captura itens sem relação com incêndio
--      (cafeteira, purificador, gerador, elevador).

-- 1. Admin compartilhado
INSERT INTO public.administradores (nome, email, role, especialidade, ativo, recebe_distribuicao, meta_semanal)
SELECT 'Gestão de Incêndio', 'maurapantoja@bemol.com.br', 'admin', 'criticos', true, true, 80
WHERE NOT EXISTS (
  SELECT 1 FROM public.administradores WHERE email = 'maurapantoja@bemol.com.br'
);

-- 2. Segundo login vinculado ao mesmo perfil
INSERT INTO public.administrador_emails (administrador_id, email)
SELECT id, 'thaisfreitas@bemol.com.br'
FROM public.administradores
WHERE email = 'maurapantoja@bemol.com.br'
ON CONFLICT (email) DO NOTHING;

-- 3. Palavras-chave novas de incêndio
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('ALARME DE INCÊNDIO',  'criticos', false),
  ('HIDRANTE',            'criticos', false),
  ('BOMBA DE INCENDIO',   'criticos', false),
  ('CENTRAL DE INCENDIO', 'criticos', false)
ON CONFLICT DO NOTHING;

-- 4. Correção de falso-positivo em MANGUEIRA: regras mais longas e
--    específicas ganham prioridade sobre a genérica (distribuir_notas ordena
--    por LENGTH(palavra_chave) DESC).
INSERT INTO public.regras_distribuicao (palavra_chave, especialidade, pula_cockpit)
VALUES
  ('MANGUEIRA DA CAFETEIRA',   'geral',      false),
  ('MANGUEIRA DO PURIFICADOR', 'geral',      false),
  ('MANGUEIRA DO GERADOR',     'elevadores', false),
  ('MANGUEIRA DE ELEVA',       'elevadores', false)
ON CONFLICT DO NOTHING;
