DROP FUNCTION IF EXISTS buscar_nota_lookup_por_numero(text, uuid);

CREATE OR REPLACE FUNCTION buscar_nota_lookup_por_numero(
  p_numero_nota         text,
  p_requesting_admin_id uuid
)
RETURNS TABLE (
  id                  uuid,
  numero_nota         text,
  descricao           text,
  status              text,
  administrador_id    uuid,
  responsavel_nome    text,
  prioridade          text,
  centro              text,
  denominacao_unidade text,
  data_criacao_sap    text,
  created_at          timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    n.id,
    n.numero_nota,
    n.descricao,
    n.status::text,
    n.administrador_id,
    a.nome              AS responsavel_nome,
    n.prioridade,
    n.centro,
    n.denominacao_unidade,
    n.data_criacao_sap::text,
    n.created_at
  FROM vw_notas_sem_ordem n
  JOIN administradores a ON a.id = n.administrador_id
  WHERE
    n.numero_nota         = p_numero_nota
    AND n.administrador_id IS NOT NULL
    AND n.administrador_id != p_requesting_admin_id
  LIMIT 1;
$$;
