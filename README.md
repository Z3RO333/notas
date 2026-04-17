# Cockpit de Distribuicao de Notas

Cockpit interno para gestao de notas e ordens de manutencao SAP, com foco em distribuicao, acompanhamento operacional, workspace de ordens e analytics gerenciais.

## Proposito

Este repositorio concentra a aplicacao web, as migrations do banco Supabase/Postgres, jobs de sync e scripts operacionais usados para:

- receber notas SAP
- distribuir notas entre administradores
- acompanhar a conversao de nota em ordem
- operar o workspace de ordens
- gerar paineis gerenciais e comparativos
- manter importacoes e reconciliacoes auxiliares

## Stack principal

- Next.js 15 + React 19 + TypeScript
- Supabase (Postgres, Auth e RPCs)
- Tailwind + Radix UI
- Recharts para graficos
- Vitest + Testing Library
- Playwright para E2E
- Python e Node.js para jobs e scripts

## Requisitos para rodar

- Node.js 20+
- npm 10+
- Python 3.11+ para scripts/jobs
- Supabase CLI 2.x
- Docker Desktop, se for subir o stack local do Supabase
- Credenciais do projeto Supabase usadas pelo time

## Variaveis de ambiente

Para a aplicacao web, use `apps/web/.env.local`.

Variaveis minimas para subir a app:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Variaveis usadas em fluxos administrativos e APIs server-side:

- `SUPABASE_SERVICE_ROLE_KEY`
- `MAINTAINER_SESSION_SECRET`
- `CRON_SECRET`
- `MAINTAINER_EMAILS`
- `UPSTASH_REDIS_REST_URL` quando o rate limit estiver habilitado
- `DEBUG_ORDERS_ROUTING` e `DEBUG_ORDERS_CD_ROUTING` para diagnostico

Observacao:

- scripts utilitarios tambem podem usar `.env` ou `.env.local` na raiz do repositorio
- nao commitar segredos; os arquivos `.env*` ja estao no `.gitignore`

## Como rodar localmente

### Atalhos pela raiz do workspace

Na maior parte do dia a dia, voce pode rodar tudo pela raiz do repositorio:

```bash
npm run dev
npm run build
npm run lint
npm run test
```

Esses atalhos orquestram a aplicacao em `apps/web` sem precisar trocar de diretoria manualmente.

### Opcao 1: app web apontando para um ambiente Supabase ja existente

```bash
cd apps/web
npm install
npm run dev
```

App:

- `http://localhost:3000`

### Opcao 2: stack Supabase local

Na raiz do repositorio:

```bash
npx supabase start
npx supabase db push
```

Depois configure `apps/web/.env.local` para o Supabase local e rode:

```bash
cd apps/web
npm install
npm run dev
```

Portas locais do Supabase definidas em `supabase/config.toml`:

- API: `54321`
- DB: `54322`
- Studio: `54323`

## Comandos uteis

### Aplicacao web

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
```

Se preferir executar direto no workspace da app:

```bash
cd apps/web
npm run dev
npm run build
npm run test
npm run test:coverage
npm run test:e2e
```

### Banco / migrations

```bash
npx supabase migration new nome_da_migration
npx supabase db push
```

### Scripts da raiz

```bash
npm run backfill:financeiro-historico
npm run backfill:ordens-historico
npm run reconcile:financeiro-ciclo-atual
```

## Estrutura do repositorio

```text
.
|- apps/
|  `- web/                       # app Next.js principal
|     `- src/
|        |- app/                # rotas App Router
|        |- components/         # componentes por dominio
|        |- lib/                # auth, supabase, queries, actions, tipos
|        `- tests/              # testes front e integracao
|- supabase/
|  |- migrations/              # schema, views, RPCs, backfills
|  |- config.toml              # configuracao do stack local
|  `- seed.sql                 # seed local quando aplicavel
|- jobs/
|  |- sync-notas/              # sync Databricks -> Supabase
|  `- databricks/              # SQL e apoio de carga
|- scripts/                    # scripts operacionais e reconciliacoes
`- docs/                       # contexto de sistema e specs
```

## Rotas importantes

| Rota | Proposito | Ponto de entrada |
|---|---|---|
| `/` | Painel operacional de notas | `apps/web/src/app/page.tsx` |
| `/ordens` | Workspace operacional de ordens | `apps/web/src/app/ordens/page.tsx` |
| `/admin` | Home gerencial de produtividade | `apps/web/src/app/admin/page.tsx` |
| `/admin/graficos` | Graficos e indicadores gerenciais | `apps/web/src/app/admin/graficos/page.tsx` |
| `/admin/pessoas` | Carga e leitura gerencial por pessoa | `apps/web/src/app/admin/pessoas/page.tsx` |
| `/admin/financeiro` | Painel financeiro | `apps/web/src/app/admin/financeiro/page.tsx` |
| `/admin/comparativos` | Comparativos gerenciais | `apps/web/src/app/admin/comparativos/page.tsx` |
| `/admin/equipamentos` | Analise por equipamentos | `apps/web/src/app/admin/equipamentos/page.tsx` |
| `/admin/radar-preventivo` | Radar preventivo | `apps/web/src/app/admin/radar-preventivo/page.tsx` |
| `/admin/operacional` | Vista operacional gerencial | `apps/web/src/app/admin/operacional/page.tsx` |
| `/api/ordens/workspace` | API principal do workspace de ordens | `apps/web/src/app/api/ordens/workspace/route.ts` |
| `/api/admin/export` | Exportacoes da area admin | `apps/web/src/app/api/admin/export/route.ts` |

Observacao:

- a arvore `/admin` e protegida para `gestor` em `apps/web/src/app/admin/layout.tsx`

## Onde mexer em cada tipo de manutencao

| Se voce quer mexer em... | Comece por aqui | Observacao |
|---|---|---|
| Painel de notas | `apps/web/src/app/page.tsx`, `apps/web/src/components/notas`, `apps/web/src/lib/notes` | Prefira a view canonica `vw_notas_sem_ordem` |
| Workspace de ordens | `apps/web/src/app/ordens/page.tsx`, `apps/web/src/components/orders`, `apps/web/src/lib/orders` | Prefira a view canonica `vw_ordens_notas_painel` |
| Paginas gerenciais `/admin` | `apps/web/src/app/admin`, `apps/web/src/components/admin` | Preserve o guard de gestor e a navegacao compartilhada |
| APIs | `apps/web/src/app/api/**/route.ts` | Mantenha a logica pesada no servidor ou no banco |
| Contratos e tipos | `apps/web/src/lib/types` | Atualize tipos junto com a origem dos dados |
| Auth e permissoes | `apps/web/src/lib/auth`, `apps/web/src/middleware.ts`, `apps/web/src/app/admin/layout.tsx` | Cuidado com escopo de admin, gestor e maintainer |
| SQL, RPCs, views, KPI, contagens | `supabase/migrations` | Adicione nova migration; nao reescreva historia |
| Normalizacao de unidade/loja | `dim_denominacao_norm`, `dim_centro_unidade`, migrations relacionadas | Evite agrupar unidade por valor cru quando houver dimensao canonica |
| Sync de notas | `jobs/sync-notas` | Fluxo Databricks -> Supabase |
| Importacoes e reconciliacoes | `scripts/` | Boa parte e operacional e deve ser tratada com cuidado |

## Regras importantes de manutencao

- `vw_notas_sem_ordem` e a fonte canonica do painel de notas
- `vw_ordens_notas_painel` e a fonte canonica do painel de ordens
- `status_ordem_raw` e a fonte de verdade para semantica de status
- prefira dimensoes, views e RPCs existentes antes de duplicar regra no frontend
- para migrations novas, sempre use o proximo numero sequencial
- use `CREATE OR REPLACE VIEW`; nao use `DROP VIEW` seguido de `CREATE VIEW`
- em funcoes `SECURITY DEFINER`, inclua `SET search_path = public`
- para analytics e contagens, valide a semantica do dado, nao apenas a sintaxe

## Fluxo recomendado para manutencao

1. Descubra a cadeia canonica do dado: tabela -> view/RPC -> loader/server component -> componente.
2. Corrija a origem mais estreita possivel.
3. Se a mudanca afetar contagem, KPI, agrupamento ou semantica, faca isso no banco em migration.
4. Atualize os tipos TypeScript que consomem esse retorno.
5. Valide com teste e build.

## Checklist rapido antes de subir mudanca

- rodou `npm run test` ou ao menos os testes proximos da area alterada
- rodou `npm run build` em `apps/web`
- se mexeu em SQL, aplicou ou ao menos validou a migration
- se mexeu em `/admin`, confirmou que o guard continua correto
- se mexeu em KPI ou agrupamento, confirmou a fonte canonica do dado

## Leitura obrigatoria antes de mexer em analytics, cockpit ou banco

- [docs/CONTEXTO_SISTEMA.md](docs/CONTEXTO_SISTEMA.md)
- [AGENTS.md](AGENTS.md)

Esses dois arquivos explicam a arquitetura funcional, as regras de semantica do banco e a forma esperada de manutencao do projeto.
