-- 00280_fix_realtime_and_sync_log_rls.sql
--
-- Problema: notas_manutencao está na publicação supabase_realtime.
-- O sync job faz UPSERT em massa (centenas a milhares de linhas) — cada linha
-- gera uma entrada WAL que o Realtime tenta processar. Os logs mostram
-- realtime.list_changes levando 10–13s por chamada, saturando CPU/IO do banco.
--
-- Fix 1: Tirar notas_manutencao e notas_historico do Realtime.
--        O frontend vai ouvir sync_log (1 INSERT por run do job) em vez disso.
--
-- Fix 2: Simplificar a policy de sync_log.
--        A policy atual chama get_my_role() → SELECT em administradores.
--        Os logs mostram essa query levando 26s quando o sync job segura um
--        lock aberto em administradores. Trocar por USING (true) para qualquer
--        usuário autenticado (todos os usuários do app são admins/gestores).

-- ============================================================
-- PARTE 1: Ajustar a publicação do Realtime
-- ============================================================

-- Remover tabelas de alta frequência de escrita do Realtime.
-- ALTER PUBLICATION ... DROP TABLE não falha se a tabela não estiver na pub.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.notas_manutencao;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.notas_historico;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

-- Adicionar sync_log à publicação (1 INSERT por run do job sync).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_log;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================================
-- PARTE 2: Simplificar RLS de sync_log
-- ============================================================

-- Dropar a policy que usa get_my_role() (gera lookup em administradores
-- que bloqueia quando o job de sync está com uma transação aberta).
DROP POLICY IF EXISTS "Gestor ve sync logs" ON public.sync_log;

-- Todos os usuários autenticados podem ler sync_log.
-- É informação operacional interna (started_at, status, contadores de notas)
-- sem dados sensíveis de usuários finais.
CREATE POLICY "Authenticated ve sync logs"
  ON public.sync_log
  FOR SELECT
  TO authenticated
  USING (true);
