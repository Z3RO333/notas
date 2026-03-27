# Project Context

## Purpose

Cockpit interno para gestao de notas e ordens de manutencao, com foco em distribuicao, acompanhamento, analytics e operacao administrativa.

## Main areas

- `apps/web/src/app/notas`: painel de notas
- `apps/web/src/app/ordens`: painel de ordens
- `apps/web/src/app/admin`: painel administrativo
- `apps/web/src/app/api`: route handlers
- `apps/web/src/components`: UI por dominio
- `apps/web/src/lib`: logica de negocio, Supabase, actions, queries, tipos
- `supabase/migrations`: schema, views, RPCs, backfills
- `jobs/sync-notas`: fluxo Databricks -> Supabase
- `scripts`: importacao, backfill e utilitarios operacionais

## Main commands

From `apps/web`:
- `npm run dev`
- `npm test`
- `npm run build`

From repo root:
- `npx supabase migration new <nome>`
- `npx supabase db push`

## Data rules

- `vw_notas_sem_ordem` is the canonical notes-panel view
- `vw_ordens_notas_painel` is the canonical orders-panel view
- `status_ordem_raw` is the source of truth for order status semantics
- prefer canonical views, dimensions, and RPCs over duplicated frontend logic

## Supabase rules

- append new migrations with the next sequential number
- use `CREATE OR REPLACE VIEW`, never drop-create
- use `SET search_path = public` in `SECURITY DEFINER` functions
- keep backfills explicit and safe for lived environments

## Frontend rules

- keep dark mode and mobile stable
- preserve loading, empty, and error states
- prefer shared components over one-off patterns
- optimize for scanability before decoration

## Operational note

When a task touches analytics, cockpit semantics, ordens, or source-of-truth counts, also read `docs/CONTEXTO_SISTEMA.md`.
