-- 00001_create_enums.sql
-- Enums para o cockpit de distribuicao de notas

-- Status do ciclo de vida das notas de manutencao
CREATE TYPE nota_status AS ENUM (
  'nova',                      -- Nota recebida, aguardando tratativa
  'em_andamento',              -- Admin esta trabalhando na nota
  'encaminhada_fornecedor',    -- Ordem gerada e encaminhada pro fornecedor
  'concluida',                 -- Tratativa finalizada
  'cancelada'                  -- Nota cancelada/invalida
);

-- Roles dos usuarios do cockpit
CREATE TYPE user_role AS ENUM (
  'admin',    -- Administrador de manutencao (processa notas)
  'gestor'    -- Gestor (ve tudo, reatribui, monitora)
);
