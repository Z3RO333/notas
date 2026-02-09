# Cockpit de Distribuicao de Notas

Sistema que distribui notas de manutencao entre administradores de forma homogenea.

## Arquitetura

```
[Databricks]                    [Windows PC]              [Supabase]           [Web]
manutencao.streaming.notas_qm -> Job (5/5 min) ----------> Tabelas Estado ----> Cockpit
                                 |                         |                    |
                                 Task Scheduler            API REST             SSO Azure AD
```

## Setup

### 1. Banco de Dados (Supabase)

1. Crie um projeto no [Supabase](https://supabase.com)
2. Execute o script `sql/schema.sql` no SQL Editor
3. Adicione os admins na tabela `admins`:

```sql
INSERT INTO admins (nome, email) VALUES
    ('Admin 1', 'admin1@empresa.com'),
    ('Admin 2', 'admin2@empresa.com'),
    ('Admin 3', 'admin3@empresa.com');
```

### 2. Backend (Job de Sincronizacao)

```bash
cd backend

# Instalar dependencias
npm install

# Copiar e configurar .env
copy .env.example .env
# Edite o .env com suas credenciais

# Build
npm run build

# Testar manualmente
npm start
```

### 3. Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Copiar e configurar .env
copy .env.example .env
# Edite o .env com suas credenciais

# Desenvolvimento
npm run dev

# Build para producao
npm run build
```

### 4. Task Scheduler (Windows)

1. Abra o **Agendador de Tarefas** (Task Scheduler)
2. Clique em **Criar Tarefa Basica**
3. Configure:
   - Nome: `Cockpit - Sync Notas`
   - Gatilho: A cada 5 minutos
   - Acao: Iniciar programa
   - Programa: `C:\projeto de notas\scripts\run-sync.bat`
4. Marque "Executar com privilegios mais altos" se necessario

## Configuracao

### Variaveis de Ambiente - Backend

| Variavel | Descricao |
|----------|-----------|
| DATABRICKS_SERVER_HOSTNAME | Host do SQL Endpoint |
| DATABRICKS_HTTP_PATH | Path do warehouse |
| DATABRICKS_TOKEN | Token de acesso |
| SUPABASE_URL | URL do projeto Supabase |
| SUPABASE_SERVICE_KEY | Service key (nao anon key) |

### Variaveis de Ambiente - Frontend

| Variavel | Descricao |
|----------|-----------|
| VITE_SUPABASE_URL | URL do projeto Supabase |
| VITE_SUPABASE_ANON_KEY | Anon key do Supabase |
| VITE_AZURE_CLIENT_ID | Client ID do App Registration |
| VITE_AZURE_TENANT_ID | Tenant ID do Azure AD |

## Estrutura

```
projeto-de-notas/
├── backend/           # Job de sincronizacao
│   ├── src/
│   │   ├── config/    # Clientes Databricks/Supabase
│   │   ├── services/  # Logica de sync e distribuicao
│   │   └── types/     # TypeScript types
│   └── logs/          # Logs do job
├── frontend/          # Cockpit web
│   └── src/
│       ├── pages/     # MinhaFila, Geral, Dashboard
│       ├── components/
│       ├── hooks/
│       └── lib/       # Supabase, MSAL config
├── scripts/           # Script para Task Scheduler
└── sql/               # Schema do banco
```

## Algoritmo de Distribuicao

A cada execucao, o job:

1. Busca notas novas do Databricks (desde ultimo watermark)
2. Insere como demandas no Supabase
3. Para cada demanda sem admin:
   - Busca admins ativos
   - Calcula carga (demandas em aberto)
   - Atribui ao admin com menor carga
4. Registra log da execucao

## Telas

- **Minha Fila**: Demandas atribuidas ao admin logado
- **Geral**: Visao de todas demandas + carga por admin
- **Dashboard**: KPIs e historico de sincronizacoes
