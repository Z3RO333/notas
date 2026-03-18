-- 00175_restore_notes_panel_to_convergidas.sql
--
-- Restaura o painel de notas para a fonte convergida do cockpit, agora que a
-- convergência voltou a refletir o recorte operacional esperado (~63-70 notas).
-- Também deixa a view compatível com a UI atual, expondo prioridade e
-- denominacao_unidade, e libera leitura do dataset convergido para admins
-- autenticados nas próprias notas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notas_convergencia_cockpit'
      AND policyname = 'Admin ve sua convergencia, gestor ve tudo'
  ) THEN
    CREATE POLICY "Admin ve sua convergencia, gestor ve tudo"
      ON public.notas_convergencia_cockpit
      FOR SELECT
      TO authenticated
      USING (
        administrador_id = public.get_my_admin_id()
        OR public.get_my_role() = 'gestor'::public.user_role
      );
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.vw_notas_cockpit_convergidas AS
SELECT
  c.nota_id AS id,
  c.numero_nota,
  c.numero_nota_norm,
  c.nota_id,
  c.ordem_sap,
  c.ordem_gerada,
  c.ordem_candidata,
  c.ordem_candidata_norm,
  c.status,
  c.descricao,
  COALESCE(nm.centro, c.centro) AS centro,
  c.administrador_id,
  c.data_criacao_sap,
  c.tem_qmel,
  c.tem_pmpl,
  c.tem_mestre,
  c.status_elegivel,
  c.tem_ordem_vinculada,
  c.eligible_cockpit,
  c.reason_not_eligible,
  c.reason_codes,
  c.sync_id,
  c.source_updated_at,
  c.created_at,
  c.updated_at,
  c.estado_operacional,
  nm.denominacao_unidade,
  nm.prioridade
FROM public.notas_convergencia_cockpit c
LEFT JOIN public.notas_manutencao nm
  ON nm.id = c.nota_id
WHERE c.eligible_cockpit = true
ORDER BY c.data_criacao_sap ASC NULLS LAST, c.updated_at ASC;

ALTER VIEW public.vw_notas_cockpit_convergidas SET (security_invoker = on);
ALTER VIEW public.vw_carga_administradores_cockpit_convergidas SET (security_invoker = on);
