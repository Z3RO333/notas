-- Adiciona política de INSERT na admin_audit_log para gestores.
-- A tabela tinha RLS habilitado mas apenas política de SELECT,
-- causando falha silenciosa em writeAdminAuditLog no SSR client.

CREATE POLICY "Gestor insere audit log"
  ON admin_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'gestor');
