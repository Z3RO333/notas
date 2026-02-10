-- 00006_seed_data.sql
-- Dados de teste para validar o cockpit
-- NOTA: Os auth_user_id abaixo sao placeholders.
-- Substitua pelos UUIDs reais apos criar usuarios no Supabase Auth.

-- Exemplo de como inserir admins (apos criar usuarios no Auth):
-- INSERT INTO public.administradores (auth_user_id, nome, email, role) VALUES
--   ('uuid-do-auth-gestor', 'Gestor Teste', 'gestor@empresa.com', 'gestor'),
--   ('uuid-do-auth-admin1', 'Admin Um', 'admin1@empresa.com', 'admin'),
--   ('uuid-do-auth-admin2', 'Admin Dois', 'admin2@empresa.com', 'admin'),
--   ('uuid-do-auth-admin3', 'Admin Tres', 'admin3@empresa.com', 'admin');

-- Notas de teste (para validar distribuicao sem depender do Databricks):
INSERT INTO public.notas_manutencao (numero_nota, tipo_nota, descricao, prioridade, centro, solicitante, data_criacao_sap, status) VALUES
  ('000100000001', 'M2', 'Vazamento na bomba de recalque - setor A', '1', 'SP01', 'USUARIO1', '2026-02-06', 'nova'),
  ('000100000002', 'M2', 'Troca de rolamento do motor principal', '2', 'SP01', 'USUARIO2', '2026-02-06', 'nova'),
  ('000100000003', 'M2', 'Calibracao do sensor de pressao', '2', 'SP01', 'USUARIO1', '2026-02-06', 'nova'),
  ('000100000004', 'M2', 'Substituicao de valvula de seguranca', '1', 'AM01', 'USUARIO3', '2026-02-06', 'nova'),
  ('000100000005', 'M2', 'Reparo no sistema de refrigeracao', '3', 'AM01', 'USUARIO2', '2026-02-06', 'nova'),
  ('000100000006', 'M2', 'Inspecao eletrica do painel de controle', '2', 'SP01', 'USUARIO4', '2026-02-06', 'nova'),
  ('000100000007', 'M2', 'Troca de correia transportadora', '1', 'AM01', 'USUARIO1', '2026-02-06', 'nova'),
  ('000100000008', 'M2', 'Lubrificacao geral da linha 3', '3', 'SP01', 'USUARIO5', '2026-02-06', 'nova'),
  ('000100000009', 'M2', 'Reparo emergencial no compressor', '1', 'AM01', 'USUARIO3', '2026-02-06', 'nova'),
  ('000100000010', 'M2', 'Alinhamento do acoplamento da turbina', '2', 'SP01', 'USUARIO2', '2026-02-06', 'nova');

-- Para testar a distribuicao:
-- 1. Crie usuarios no Supabase Auth
-- 2. Insira os administradores com os auth_user_id corretos
-- 3. Execute: SELECT * FROM distribuir_notas(NULL);
-- 4. Verifique: SELECT * FROM vw_carga_administradores;
