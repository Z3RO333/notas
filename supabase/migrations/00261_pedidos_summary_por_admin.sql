CREATE OR REPLACE FUNCTION listar_pedidos_summary_por_admin(
  p_admin_scope uuid DEFAULT NULL
)
RETURNS TABLE (
  admin_id      uuid,
  nome          text,
  avatar_url    text,
  especialidade text,
  em_aberto     bigint,
  encerrado     bigint,
  cancelado     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id                                                        AS admin_id,
    a.nome,
    a.avatar_url,
    a.especialidade::text,
    COUNT(*) FILTER (WHERE pc.status = 'em_aberto')            AS em_aberto,
    COUNT(*) FILTER (WHERE pc.status = 'encerrado')            AS encerrado,
    COUNT(*) FILTER (WHERE pc.status = 'cancelado')            AS cancelado
  FROM administradores a
  LEFT JOIN pedidos_compra pc ON pc.administrador_id = a.id
  WHERE a.ativo = true
    AND a.recebe_distribuicao = true
    AND (p_admin_scope IS NULL OR a.id = p_admin_scope)
  GROUP BY a.id, a.nome, a.avatar_url, a.especialidade
  ORDER BY a.nome;
$$;
