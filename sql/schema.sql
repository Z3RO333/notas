-- =============================================
-- COCKPIT DE DISTRIBUICAO DE NOTAS
-- Schema Supabase
-- =============================================

-- Extensao para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABELA: admins
-- Administradores que recebem notas para tratar
-- =============================================
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    ativo BOOLEAN DEFAULT true,
    peso INTEGER DEFAULT 1,
    limite_max INTEGER DEFAULT 999,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index para busca por email (login)
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_ativo ON admins(ativo) WHERE ativo = true;

-- =============================================
-- TABELA: demandas
-- Notas vindas do Databricks para distribuicao
-- =============================================
CREATE TABLE IF NOT EXISTS demandas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Campos do Databricks (SAP)
    numero_nota TEXT UNIQUE NOT NULL,
    tipo_nota TEXT,
    texto_breve TEXT,
    prioridade TEXT,
    tipo_prioridade TEXT,
    centro_material TEXT,
    criado_por TEXT,
    data_criacao_sap DATE,

    -- Campos de controle do cockpit
    status TEXT DEFAULT 'nova' CHECK (status IN ('nova', 'em_andamento', 'encaminhada', 'concluida', 'cancelada')),
    admin_id UUID REFERENCES admins(id),
    atribuido_em TIMESTAMP WITH TIME ZONE,

    -- Payload completo do Databricks
    dados_originais JSONB,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_demandas_numero_nota ON demandas(numero_nota);
CREATE INDEX IF NOT EXISTS idx_demandas_admin_id ON demandas(admin_id);
CREATE INDEX IF NOT EXISTS idx_demandas_status ON demandas(status);
CREATE INDEX IF NOT EXISTS idx_demandas_data_criacao ON demandas(data_criacao_sap DESC);
CREATE INDEX IF NOT EXISTS idx_demandas_admin_status ON demandas(admin_id, status);

-- =============================================
-- TABELA: log_execucoes
-- Historico de cada execucao do job de sync
-- =============================================
CREATE TABLE IF NOT EXISTS log_execucoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    executado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    qtd_novas INTEGER DEFAULT 0,
    qtd_atribuidas INTEGER DEFAULT 0,
    erros TEXT,
    watermark TIMESTAMP WITH TIME ZONE,
    duracao_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_log_execucoes_data ON log_execucoes(executado_em DESC);

-- =============================================
-- VIEW: carga_admins
-- Mostra a carga atual de cada admin
-- =============================================
CREATE OR REPLACE VIEW carga_admins AS
SELECT
    a.id,
    a.nome,
    a.email,
    a.ativo,
    a.peso,
    a.limite_max,
    COUNT(d.id) FILTER (WHERE d.status IN ('nova', 'em_andamento')) AS carga_atual,
    COUNT(d.id) FILTER (WHERE d.status = 'nova') AS qtd_nova,
    COUNT(d.id) FILTER (WHERE d.status = 'em_andamento') AS qtd_em_andamento,
    COUNT(d.id) FILTER (WHERE d.status = 'encaminhada') AS qtd_encaminhada,
    COUNT(d.id) FILTER (WHERE d.status = 'concluida') AS qtd_concluida,
    MAX(d.atribuido_em) AS ultima_atribuicao
FROM admins a
LEFT JOIN demandas d ON a.id = d.admin_id
GROUP BY a.id, a.nome, a.email, a.ativo, a.peso, a.limite_max;

-- =============================================
-- FUNCAO: escolher_admin_menor_carga
-- Retorna o admin com menor carga atual
-- =============================================
CREATE OR REPLACE FUNCTION escolher_admin_menor_carga()
RETURNS UUID AS $$
DECLARE
    admin_escolhido UUID;
BEGIN
    SELECT id INTO admin_escolhido
    FROM carga_admins
    WHERE ativo = true
      AND carga_atual < limite_max
    ORDER BY
        carga_atual ASC,
        ultima_atribuicao ASC NULLS FIRST
    LIMIT 1;

    RETURN admin_escolhido;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- FUNCAO: atribuir_demanda
-- Atribui uma demanda ao admin com menor carga
-- =============================================
CREATE OR REPLACE FUNCTION atribuir_demanda(p_demanda_id UUID)
RETURNS UUID AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    -- Escolhe o admin
    v_admin_id := escolher_admin_menor_carga();

    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Nenhum admin disponivel para atribuicao';
    END IF;

    -- Atualiza a demanda
    UPDATE demandas
    SET
        admin_id = v_admin_id,
        atribuido_em = NOW(),
        updated_at = NOW()
    WHERE id = p_demanda_id
      AND admin_id IS NULL;

    RETURN v_admin_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- FUNCAO: distribuir_novas_demandas
-- Distribui todas as demandas sem admin
-- =============================================
CREATE OR REPLACE FUNCTION distribuir_novas_demandas()
RETURNS TABLE(demanda_id UUID, admin_id UUID) AS $$
DECLARE
    rec RECORD;
    v_admin_id UUID;
BEGIN
    FOR rec IN
        SELECT id FROM demandas
        WHERE admin_id IS NULL
        ORDER BY data_criacao_sap ASC, created_at ASC
    LOOP
        v_admin_id := atribuir_demanda(rec.id);
        demanda_id := rec.id;
        admin_id := v_admin_id;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGER: updated_at automatico
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_admins_updated_at
    BEFORE UPDATE ON admins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_demandas_updated_at
    BEFORE UPDATE ON demandas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- DADOS INICIAIS (exemplo - remover em producao)
-- =============================================
-- INSERT INTO admins (nome, email) VALUES
--     ('Admin 1', 'admin1@empresa.com'),
--     ('Admin 2', 'admin2@empresa.com'),
--     ('Admin 3', 'admin3@empresa.com');
