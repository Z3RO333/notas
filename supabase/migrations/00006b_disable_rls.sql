-- Desabilita RLS para permitir acesso sem autenticação
-- O sistema agora funciona como painel aberto sem login

ALTER TABLE notas_manutencao DISABLE ROW LEVEL SECURITY;
ALTER TABLE administradores DISABLE ROW LEVEL SECURITY;
ALTER TABLE notas_historico DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE distribuicao_log DISABLE ROW LEVEL SECURITY;
