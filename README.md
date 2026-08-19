# Cockpit de Distribuição de Notas e Ordens

Plataforma Full-Stack para gestão de notas e ordens de manutenção, distribuição de demandas, acompanhamento operacional e analytics gerenciais.

## Visão geral

O sistema centraliza o fluxo entre notas, ordens, responsáveis e indicadores, substituindo controles fragmentados por um cockpit único. A aplicação combina frontend moderno, regras de negócio server-side, banco relacional, autenticação corporativa e rotinas de sincronização de dados.

## Principais funcionalidades

- Distribuição de notas entre responsáveis
- Acompanhamento da conversão de nota em ordem
- Workspace operacional de ordens
- Dashboards de produtividade, financeiro e comparativos
- Análises por pessoas, unidades e equipamentos
- Radar preventivo e visão operacional gerencial
- Importações, backfills e reconciliações de dados
- Integração com jobs de sincronização e fontes externas
- Controle de acesso por perfil

## Stack principal

- Next.js 15
- React 19
- TypeScript
- Supabase / PostgreSQL
- Auth.js / NextAuth
- Microsoft Entra ID
- Tailwind CSS + Radix UI
- Recharts
- Vitest + Testing Library
- Playwright
- Node.js
- Python
- Databricks

## Arquitetura

O repositório concentra:

- aplicação web em Next.js
- migrations, views e RPCs no Supabase/Postgres
- jobs de sincronização de dados
- scripts operacionais e de reconciliação
- testes unitários e E2E
- módulos gerenciais e operacionais separados por domínio

## Destaques técnicos

- regras de negócio concentradas no backend e banco quando apropriado
- uso de views e RPCs para padronizar indicadores e semântica dos dados
- autenticação corporativa com Microsoft Entra ID
- controle de acesso por perfil
- testes automatizados de frontend, integração e E2E
- estrutura preparada para analytics e grandes volumes de dados

## Objetivo

Criar uma visão única da operação de manutenção, reduzindo trabalho manual, melhorando a distribuição de demandas e permitindo decisões baseadas em dados.

## Segurança e contexto corporativo

Este projeto foi desenvolvido em contexto corporativo. Credenciais, tokens, dados reais, endpoints privados e informações sensíveis não devem ser expostos publicamente.

## Execução local

```bash
npm install
npm run dev
```

Para validação:

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
```
