-- =============================================
-- MIGRATION 00013: View de produtividade mensal
-- Agrega notas concluidas por admin por mes
-- para medir produtividade individual
-- =============================================

CREATE OR REPLACE VIEW public.vw_produtividade_mensal AS
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  date_trunc('month', h.created_at) AS mes,
  COUNT(*) AS qtd_concluidas
FROM public.notas_historico h
JOIN public.notas_manutencao n ON n.id = h.nota_id
JOIN public.administradores a ON a.id = n.administrador_id
WHERE h.campo_alterado = 'status'
  AND h.valor_novo = 'concluida'
GROUP BY a.id, a.nome, a.avatar_url, a.especialidade, date_trunc('month', h.created_at);
